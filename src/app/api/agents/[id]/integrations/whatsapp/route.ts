import { canConnectWhatsApp, getWorkspaceLimits } from '@/lib/limits'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { manageAgent } from '@/lib/auth/agent'
import { lineName, phoneFromConfig } from '@/lib/conversation-line'
import type { AgentIntegration } from '@prisma/client'
import {
    CHANNEL_PROVIDER,
    ChannelProviderError,
    evolutionGo,
    type IntegrationConfig,
    readIntegrationConfig,
    resolveIntegration,
    toJsonConfig,
    webhookUrlFor,
} from '@/lib/whatsapp'
import type { ConnectionState } from '@/lib/whatsapp/types'

/**
 * As linhas de WhatsApp de um agente, servidas por Evolution Go (whatsmeow).
 *
 * **Endereçada por linha, não por agente.** Um agente atende por N números — duas
 * unidades da clínica, dois consultórios — então o parâmetro que identifica o
 * que se está conectando é `integrationId`, e não mais só o id do agente. Sem
 * ele, a rota cria uma linha nova; com ele, reconecta aquela.
 *
 * Evolution Go splits what Evolution API v2 did in one call: creation is an
 * admin-key operation that mints the per-instance token, and connecting is a
 * per-instance call that carries the webhook URL and event subscription. The token
 * is the only way to address the instance afterwards, so persisting it is the
 * critical step here.
 */

const CHANNEL = 'whatsapp_qr'

/**
 * O nome da instância no provedor é o id da linha.
 *
 * Era `odontobox_<workspace>_<agente>`, cortado em 50 caracteres — e o corte
 * caía **dentro** do id do agente, que são 25 caracteres: dois agentes do mesmo
 * workspace com prefixo igual colidiriam, e duas linhas do mesmo agente
 * colidiriam sempre. O id da linha é único por construção e cabe inteiro.
 *
 * As linhas antigas guardam o nome em `config` e continuam com ele; esta função
 * só nomeia linha nova.
 */
function instanceNameFor(integrationId: string): string {
    return `odontobox_${integrationId}`
}

async function persistConfig(
    integrationId: string,
    status: string,
    config: IntegrationConfig
): Promise<AgentIntegration> {
    return prisma.agentIntegration.update({
        where: { id: integrationId },
        data: { status, config: toJsonConfig(config), errorMessage: null },
    })
}

/**
 * Grava o número na coluna, que é onde ele é único no sistema inteiro.
 *
 * A coluna e seu índice único parcial existem desde 20261007120000 e nunca
 * foram escritos: o guarda que impede o mesmo número em duas contas estava
 * desligado, e o número só vivia dentro do JSON de `config`. Com N linhas por
 * agente ele passa a ser a identidade da linha na tela, então sai do JSON.
 *
 * Devolve `false` quando o índice recusa — o número está em outra linha, aqui ou
 * em outra conta. Isso **não** é um erro do sistema: é a resposta certa, e quem
 * chama transforma em recusa visível em vez de deixar o pareamento concluir
 * sobre um número que não é desta clínica.
 */
async function claimPhoneNumber(integrationId: string, phone: string): Promise<boolean> {
    try {
        await prisma.agentIntegration.update({
            where: { id: integrationId },
            data: { phoneNumber: phone },
        })
        return true
    } catch {
        return false
    }
}

const NUMBER_TAKEN =
    'Este número de WhatsApp já está conectado em outra linha. ' +
    'Desconecte-o lá antes de conectá-lo aqui.'

/**
 * Quanto tempo uma sessão pode ficar "voltando" antes de ser dada por morta.
 *
 * Generoso de propósito: a janela que importa proteger são os segundos logo
 * depois do pareamento, e dez minutos cobrem também uma queda de rede e um
 * reinício do host.
 */
const JANELA_DE_RECONEXAO_MS = 10 * 60_000

/**
 * A instância já pareou e está apenas restabelecendo a sessão — não mexa no QR.
 *
 * Isto existe porque pedir QR de uma instância pareada é DESTRUTIVO, e foi o que
 * desconectou o primeiro número a entrar no sistema. A sequência, medida nos logs:
 *
 *   12:56:27  PairSuccess — número 553131918001 pareado
 *   12:56:27  whatsmeow recebe código 515 e reconecta (normal, logo após parear)
 *   12:56:30  o polling lê LoggedIn:false, conclui "ainda pareando" e chama
 *             GET /instance/qr
 *   12:57:10  o Evolution Go abre um ciclo de QR novo sobre a sessão recém-criada
 *   12:58:10  QRTimeout
 *   12:58:11  LoggedOut — o número é desconectado pelo próprio sistema que
 *             acabara de conectá-lo
 *
 * **O marcador antigo era largo demais.** Era só "há número na configuração" —
 * que nunca deixa de ser verdade. Uma linha cuja sessão morreu de vez ficava
 * presa: `Reconectar` nunca mostrava QR, e nada na tela dizia que o caminho era
 * Desconectar antes. Medido na linha da Ruth, parada desde 01:26 com
 * `disconnect_reason: Reconnecting` e `/instance/qr` respondendo "no QR code
 * available" indefinidamente.
 *
 * Agora são três perguntas, nesta ordem: já pareou alguma vez? o soquete ainda
 * está aberto — ou seja, a sessão está de fato voltando? e, se não está, o
 * pareamento é recente o bastante para merecer paciência? Os segundos logo após
 * o `PairSuccess` passam pela terceira pergunta mesmo com o soquete oscilando,
 * que é exatamente a janela que o incidente exige proteger.
 */
function isReconnecting(state: ConnectionState, line: AgentIntegration): boolean {
    if (state.connected) return false
    /**
     * "Já pareou" é a **coluna**, não o JSON da configuração.
     *
     * O webhook de conexão apaga `phoneNumber` do JSON num LoggedOut, de
     * propósito. Lendo de lá, uma linha que acabou de perder a sessão parecia
     * nunca ter pareado — e aí nem a espera da reconexão valia. A coluna sobrevive
     * ao LoggedOut: uma linha fora do ar continua sendo o número daquela clínica.
     */
    if (!line.phoneNumber) return false
    // Soquete aberto: a sessão existe e está voltando.
    if (state.socketOpen) return true
    return (
        line.connectedAt !== null &&
        Date.now() - line.connectedAt.getTime() < JANELA_DE_RECONEXAO_MS
    )
}

/**
 * Troca a instância morta por uma nova, para que o QR volte a ser possível.
 *
 * O Evolution Go **não emite QR enquanto a instância guarda um JID**: o
 * `/instance/connect` tenta retomar a sessão antiga, o `/instance/status`
 * responde `Connected:false, LoggedIn:false` e o `/instance/qr` responde "no QR
 * code available" para sempre. Não há `logout` na API — medido: o endpoint não
 * existe, e `/instance/disconnect` responde "no active session found".
 *
 * Então reconectar uma sessão morta é, necessariamente, parear de novo. Era o
 * que o botão Desconectar fazia, só que escondido atrás de um passo que ninguém
 * tinha motivo para adivinhar.
 *
 * Só acontece a pedido — um clique em Reconectar — e só depois de `isReconnecting`
 * concluir que não há sessão voltando. O polling nunca chega aqui.
 */
async function recycleInstance(
    line: AgentIntegration,
    credentials: IntegrationConfig
): Promise<IntegrationConfig> {
    await evolutionGo.deleteInstance(credentials).catch((error) => {
        // Uma instância que não some do provedor não pode travar o pareamento:
        // a nova nasce com outro nome e a órfã fica para trás.
        console.error('[WHATSAPP_INTEGRATION] could not delete dead instance:', error)
    })

    // Nome novo: reaproveitar o anterior esbarraria na instância órfã quando a
    // remoção falha, e a recuperação por nome devolveria justamente o token
    // morto que estamos descartando.
    const instanceName = `${instanceNameFor(line.id)}_${Date.now().toString(36)}`
    const created = await evolutionGo.createInstance(instanceName)

    // O número sai do registro: ele é o marcador de "já pareou", e a linha
    // acabou de voltar a zero. Sem isto `isReconnecting` bloquearia o QR da
    // instância nova. A coluna é única no sistema inteiro, então limpá-la também
    // devolve o número para ser reivindicado no pareamento.
    await prisma.agentIntegration.update({
        where: { id: line.id },
        data: { phoneNumber: null, connectedAt: null },
    })

    return {
        instanceName: created.instanceName,
        instanceId: created.instanceId,
        token: created.token,
    }
}

/** A linha pedida, confirmada como sendo deste agente e deste workspace. */
async function findLine(
    integrationId: string,
    agentId: string,
    workspaceId: string
): Promise<AgentIntegration | null> {
    return prisma.agentIntegration.findFirst({
        where: {
            id: integrationId,
            agentId,
            channel: CHANNEL,
            agent: { workspaceId },
        },
    })
}

/** O que a tela mostra de cada linha, sem bater no provedor. */
function toListItem(line: AgentIntegration) {
    return {
        id: line.id,
        label: line.label,
        departmentId: line.departmentId,
        phoneNumber: line.phoneNumber ?? phoneFromConfig(line.config),
        status: line.status,
        connectedAt: line.connectedAt,
        lastActiveAt: line.lastActiveAt,
        errorMessage: line.errorMessage,
        /** Se já pareou alguma vez: separa "reconectar" de "parear do zero". */
        paired: Boolean(line.phoneNumber ?? phoneFromConfig(line.config)),
    }
}

/**
 * POST — conecta.
 *
 * Com `integrationId` no corpo, reconecta aquela linha. Sem, cria uma linha nova
 * (contra o teto do plano) e começa o pareamento.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    let criada: string | null = null
    try {
        const { id: agentId } = await params
        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response
        const { workspaceId } = auth.member

        const body = (await request.json().catch(() => ({}))) as {
            integrationId?: string
            label?: string
        }

        let line: AgentIntegration | null = null

        if (body.integrationId) {
            line = await findLine(body.integrationId, agentId, workspaceId)
            if (!line) {
                return NextResponse.json({ error: 'Linha não encontrada' }, { status: 404 })
            }
            if (line.status === 'connected') {
                return NextResponse.json(
                    { error: 'Esta linha já está conectada', status: 'connected' },
                    { status: 400 }
                )
            }
        }

        // Quantos números o plano permite. Reconectar uma linha existente é
        // isento — ela já ocupa a vaga dela.
        const allowed = await canConnectWhatsApp(workspaceId, line?.id)
        if (!allowed.ok) {
            return NextResponse.json({ error: allowed.error }, { status: allowed.status })
        }

        if (!line) {
            /**
             * A linha nasce no banco antes de existir no provedor.
             *
             * O id vem daqui e não do banco porque o **nome da instância é o
             * id**: gerando-o antes, o registro nasce já com a configuração
             * certa, numa escrita só. Deixando o banco gerar, haveria um
             * instante com `instanceName` vazio — e `readIntegrationConfig`
             * recusa configuração sem nome.
             *
             * Se o provisionamento falhar, o registro é apagado no `catch`: uma
             * linha fantasma na lista é pior que um erro na tela.
             */
            const id = `wa${randomUUID().replace(/-/g, '')}`
            line = await prisma.agentIntegration.create({
                data: {
                    id,
                    agentId,
                    channel: CHANNEL,
                    status: 'pending',
                    label: body.label?.trim() || null,
                    config: toJsonConfig({ instanceName: instanceNameFor(id) }),
                },
            })
            criada = line.id
        }

        const stored = (line.config ?? {}) as Partial<IntegrationConfig>
        const instanceName = stored.instanceName || instanceNameFor(line.id)

        let credentials: IntegrationConfig = {
            instanceName,
            instanceId: stored.instanceId,
            token: stored.token,
            phoneNumber: stored.phoneNumber,
        }

        // Provision only when we have no usable token; re-creating would orphan
        // the existing instance.
        if (!credentials.token) {
            try {
                const created = await evolutionGo.createInstance(instanceName)
                credentials = {
                    ...credentials,
                    instanceName: created.instanceName,
                    instanceId: created.instanceId,
                    token: created.token,
                }
            } catch (error) {
                if (!(error instanceof ChannelProviderError) || !error.isConflict) throw error

                // The name is taken by an instance whose token we lost. /instance/all
                // is the only place the token is exposed, so recover it there.
                const recovered = await evolutionGo.findInstanceByName(instanceName)
                if (!recovered?.token) {
                    return NextResponse.json(
                        {
                            error:
                                'A instância existe no Evolution Go mas o token não pôde ser ' +
                                'recuperado. Remova a instância no painel do Evolution Go e tente de novo.',
                        },
                        { status: 409 }
                    )
                }
                credentials = { ...credentials, ...recovered }
            }
        }

        // Persist before connecting: if /instance/connect fails we must not lose
        // the token, or the instance becomes unreachable.
        await persistConfig(line.id, 'pending', credentials)
        criada = null

        const state = await evolutionGo.getConnectionState(credentials).catch(() => null)

        if (state?.connected) {
            const phone = state.phoneNumber ?? credentials.phoneNumber ?? null
            if (phone && !(await claimPhoneNumber(line.id, phone))) {
                await prisma.agentIntegration.update({
                    where: { id: line.id },
                    data: { status: 'error', errorMessage: NUMBER_TAKEN },
                })
                return NextResponse.json({ error: NUMBER_TAKEN }, { status: 409 })
            }
            const integration = await prisma.agentIntegration.update({
                where: { id: line.id },
                data: {
                    status: 'connected',
                    connectedAt: new Date(),
                    lastActiveAt: new Date(),
                    errorMessage: null,
                    config: toJsonConfig({ ...credentials, phoneNumber: phone ?? undefined }),
                },
            })

            return NextResponse.json({
                success: true,
                integration: { id: integration.id, status: 'connected' },
                qrcode: null,
                alreadyConnected: true,
            })
        }

        if (state && isReconnecting(state, line)) {
            // Sessão voltando: `connect` + QR aqui recomeçaria o pareamento e
            // desconectaria o número. Ver isReconnecting.
            const pendente = await persistConfig(line.id, 'pending', credentials)
            return NextResponse.json({
                success: true,
                integration: { id: pendente.id, status: 'pending' },
                qrcode: null,
                reconnecting: true,
                phoneNumber: credentials.phoneNumber ?? null,
            })
        }

        /**
         * A instância ainda guarda um JID? Então ela nunca vai emitir QR.
         *
         * Esta é a pergunta certa, e é ao provedor que ela se faz. A primeira
         * versão perguntava ao nosso JSON ("tem número guardado?") e errava no
         * caso mais comum de todos: o webhook de LoggedOut apaga esse campo, e
         * aí uma linha derrubada caía num segundo estado travado — sem
         * reciclagem, sem QR, e com o JID ainda lá do lado de lá.
         */
        let reparada = false
        const jid = await evolutionGo.getOwnerJid(credentials).catch(() => undefined)
        if (jid) {
            credentials = await recycleInstance(line, credentials)
            await persistConfig(line.id, 'pending', credentials)
            reparada = true
        }

        await evolutionGo.connect(credentials, webhookUrlFor(CHANNEL_PROVIDER[CHANNEL]))

        const qr = await evolutionGo.getQrCode(credentials).catch(() => null)
        const integration = await persistConfig(line.id, 'pending', credentials)

        return NextResponse.json({
            success: true,
            integration: { id: integration.id, status: integration.status },
            // The socket may not have produced a QR yet; the modal polls GET.
            qrcode: qr?.base64 ?? null,
            pairingCode: qr?.code ?? null,
            // A tela avisa que este QR vale um pareamento novo, não a volta do
            // anterior — o aparelho precisa ler de novo.
            repaired: reparada,
        })
    } catch (error) {
        // Uma linha criada nesta requisição que não chegou a ser provisionada não
        // pode sobrar na lista nem ocupar vaga do plano.
        if (criada) {
            await prisma.agentIntegration
                .delete({ where: { id: criada } })
                .catch(() => undefined)
        }
        const message = error instanceof Error ? error.message : 'Erro desconhecido'
        console.error('[WHATSAPP_INTEGRATION] Error:', message, error)
        return NextResponse.json({ error: `Erro ao conectar WhatsApp: ${message}` }, { status: 500 })
    }
}

/**
 * GET — as linhas do agente, ou o estado ao vivo de uma delas.
 *
 * Sem `integrationId`, devolve a lista como está no banco, sem chamar o provedor:
 * é o que a aba Canais desenha, e uma chamada por linha a um provedor que já
 * pendurou 75 s deixaria a aba inteira em branco. Com `integrationId`, consulta o
 * provedor e devolve o QR — é o que o modal de pareamento busca a cada 2 s.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params
        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response
        const { workspaceId } = auth.member

        const integrationId = new URL(request.url).searchParams.get('integrationId')

        if (!integrationId) {
            const [lines, limits, departments] = await Promise.all([
                prisma.agentIntegration.findMany({
                    where: { agentId, channel: CHANNEL },
                    orderBy: { createdAt: 'asc' },
                }),
                getWorkspaceLimits(workspaceId),
                // Junto com as linhas, para o seletor de fila não precisar de uma
                // segunda chamada que pode discordar desta.
                prisma.department.findMany({
                    where: { workspaceId },
                    orderBy: { name: 'asc' },
                    select: { id: true, name: true },
                }),
            ])
            return NextResponse.json({
                lines: lines.map(toListItem),
                limit: limits.whatsapp,
                departments,
            })
        }

        const integration = await findLine(integrationId, agentId, workspaceId)
        if (!integration) {
            return NextResponse.json({ error: 'Linha não encontrada' }, { status: 404 })
        }

        let credentials: IntegrationConfig
        try {
            credentials = readIntegrationConfig(integration)
        } catch {
            return NextResponse.json({
                status: integration.status,
                connected: integration.status === 'connected',
                errorMessage: 'Integração sem configuração válida; reconecte.',
                phoneNumber: null,
            })
        }

        try {
            const { provider } = resolveIntegration(integration)
            const state = await provider.getConnectionState(credentials)

            const phoneNumber = state.phoneNumber ?? credentials.phoneNumber ?? null

            if (state.connected) {
                if (phoneNumber && integration.phoneNumber !== phoneNumber) {
                    if (!(await claimPhoneNumber(integration.id, phoneNumber))) {
                        await prisma.agentIntegration.update({
                            where: { id: integration.id },
                            data: { status: 'error', errorMessage: NUMBER_TAKEN },
                        })
                        return NextResponse.json({
                            status: 'error',
                            connected: false,
                            errorMessage: NUMBER_TAKEN,
                            phoneNumber,
                        })
                    }
                }
                if (integration.status !== 'connected' || phoneNumber !== credentials.phoneNumber) {
                    await prisma.agentIntegration.update({
                        where: { id: integration.id },
                        data: {
                            status: 'connected',
                            connectedAt: integration.connectedAt ?? new Date(),
                            lastActiveAt: new Date(),
                            errorMessage: null,
                            config: toJsonConfig({ ...credentials, phoneNumber: phoneNumber ?? undefined }),
                        },
                    })
                }

                return NextResponse.json({
                    status: 'connected',
                    connected: true,
                    lastActiveAt: integration.lastActiveAt,
                    phoneNumber,
                })
            }

            if (isReconnecting(state, integration)) {
                // Reconexão: a sessão existe e está voltando. Pedir QR aqui
                // derrubaria o número — ver isReconnecting.
                //
                // O POST checava isto junto com `socketOpen` e o GET não, então
                // o polling recusava o QR em casos que o POST já tinha liberado:
                // a tela ficava esperando para sempre um código que ninguém
                // buscava. Agora o critério é um só, nos dois lugares.
                return NextResponse.json({
                    status: integration.status,
                    connected: false,
                    reconnecting: true,
                    lastActiveAt: integration.lastActiveAt,
                    phoneNumber,
                })
            }

            // Primeiro pareamento: aí sim o QR, que o modal renova conforme o
            // Evolution Go o rotaciona.
            const qr = await provider.getQrCode(credentials).catch(() => null)

            return NextResponse.json({
                status: integration.status,
                connected: false,
                lastActiveAt: integration.lastActiveAt,
                phoneNumber,
                qrcode: qr?.base64 ?? null,
                pairingCode: qr?.code ?? null,
            })
        } catch (error) {
            // Provider unreachable: report what the database knows rather than failing.
            console.error('[WHATSAPP_INTEGRATION] State check failed:', error)
            return NextResponse.json({
                status: integration.status,
                connected: integration.status === 'connected',
                errorMessage: integration.errorMessage,
                phoneNumber: credentials.phoneNumber ?? null,
            })
        }
    } catch (error) {
        console.error('[WHATSAPP_INTEGRATION] Error:', error)
        return NextResponse.json({ error: 'Erro ao verificar status' }, { status: 500 })
    }
}

/**
 * PATCH — o apelido da linha e de quem é a fila dela.
 *
 * Os dois campos são independentes: o corpo pode trazer um, o outro, ou os dois,
 * e o que não vier fica como está. `departmentId: null` tira a linha do
 * departamento e devolve a fila dela para a geral da clínica.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params
        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response
        const { workspaceId } = auth.member

        const body = (await request.json().catch(() => ({}))) as {
            integrationId?: string
            label?: string
            departmentId?: string | null
        }
        if (!body.integrationId) {
            return NextResponse.json({ error: 'Linha não informada' }, { status: 400 })
        }

        const line = await findLine(body.integrationId, agentId, workspaceId)
        if (!line) return NextResponse.json({ error: 'Linha não encontrada' }, { status: 404 })

        const data: { label?: string | null; departmentId?: string | null } = {}

        if (typeof body.label === 'string') {
            data.label = body.label.trim().slice(0, 60) || null
        }

        if ('departmentId' in body) {
            const wanted = body.departmentId || null
            if (wanted) {
                // Do mesmo workspace: `departmentId` é um campo de texto como
                // qualquer outro, e sem esta checagem a linha poderia apontar
                // para o departamento de outra clínica.
                const department = await prisma.department.findFirst({
                    where: { id: wanted, workspaceId },
                    select: { id: true },
                })
                if (!department) {
                    return NextResponse.json(
                        { error: 'Departamento não encontrado' },
                        { status: 404 }
                    )
                }
            }
            data.departmentId = wanted
        }

        if (Object.keys(data).length === 0) {
            return NextResponse.json(toListItem(line))
        }

        const updated = await prisma.agentIntegration.update({
            where: { id: line.id },
            data,
        })
        return NextResponse.json(toListItem(updated))
    } catch (error) {
        console.error('[WHATSAPP_INTEGRATION] Update failed:', error)
        return NextResponse.json({ error: 'Erro ao atualizar a linha' }, { status: 500 })
    }
}

/**
 * DELETE — desconecta a linha, ou remove a linha inteira.
 *
 * `?integrationId=x` desconecta: a sessão no provedor morre, o registro fica, e o
 * número continua sendo desta clínica à espera de reconectar. As conversas que
 * entraram por ela seguem apontando para ela.
 *
 * `?integrationId=x&remove=true` apaga o registro — é como se devolve a vaga do
 * plano de uma linha que não se vai usar mais. Só funciona com a linha
 * desconectada, para que "remover" nunca seja o caminho acidental de derrubar um
 * número no ar. As conversas não vão com ela: `integrationId` volta a nulo e o
 * histórico fica.
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params
        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const url = new URL(request.url)
        const integrationId = url.searchParams.get('integrationId')
        const remove = url.searchParams.get('remove') === 'true'

        const line = integrationId
            ? await findLine(integrationId, agentId, auth.member.workspaceId)
            : // Sem id, a única linha do agente — compatibilidade com quem ainda
              // chama a rota sem parâmetro.
              await prisma.agentIntegration.findFirst({
                  where: { agentId, channel: CHANNEL, agent: { workspaceId: auth.member.workspaceId } },
                  orderBy: { createdAt: 'asc' },
              })

        if (!line) {
            return NextResponse.json({ error: 'Linha não encontrada' }, { status: 404 })
        }

        if (remove) {
            if (line.status === 'connected') {
                return NextResponse.json(
                    {
                        error: `${lineName(line)} está conectada. Desconecte-a antes de removê-la.`,
                    },
                    { status: 409 }
                )
            }
            await prisma.agentIntegration.delete({ where: { id: line.id } })
            return NextResponse.json({ success: true, removed: true })
        }

        try {
            const { provider, credentials } = resolveIntegration(line)
            await provider.deleteInstance(credentials)
        } catch (error) {
            // A provider-side instance we cannot delete must not block the local
            // disconnect; it is reclaimed by name on the next connect.
            console.error('[WHATSAPP_INTEGRATION] Error deleting instance:', error)
        }

        const stored = (line.config ?? {}) as Partial<IntegrationConfig>
        await prisma.agentIntegration.update({
            where: { id: line.id },
            data: {
                status: 'disconnected',
                connectedAt: null,
                // Drop the token: a deleted instance's token is dead, and keeping it
                // would make the next connect skip provisioning. O nome fica, para
                // o próximo connect reclamar a mesma instância.
                config: toJsonConfig({
                    instanceName: stored.instanceName || instanceNameFor(line.id),
                }),
            },
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[WHATSAPP_INTEGRATION] Error:', error)
        return NextResponse.json({ error: 'Erro ao desconectar' }, { status: 500 })
    }
}
