import 'server-only'
import prisma from '@venn/db/cliente'
import { createLogger } from '../../trabalhos/registro'
import { criarInstanciaDoFunil, temMotorDoFunil } from '../../trabalhos/funil'
import { cicloNoDesenho, primeiroPasso } from './passos'
import { casa, lerGatilho, type EventoDeGatilho } from './gatilho'

const log = createLogger('FUNIL')

/**
 * Faz alguém entrar nos funis que este evento liga.
 *
 * ## Nunca lança
 *
 * Os pontos de disparo são rotas que estão fazendo outra coisa — aplicar uma
 * etiqueta, mover um negócio, criar um contato. Uma exceção aqui derrubaria a
 * operação que o usuário pediu por causa de um automatismo que ele talvez nem
 * saiba que existe. Então tudo é registrado e nada propaga.
 *
 * ## E não bloqueia
 *
 * Quem chama decide se espera. Em rota do Next, o certo é esperar — a criação da
 * instância é uma chamada de binding, não uma viagem longa, e não esperar
 * deixaria a resposta sair antes de a passagem existir, com a tela mostrando
 * "0 ativos" logo depois de o gatilho acontecer.
 */
export async function talvezEntrarNoFunil(evento: EventoDeGatilho): Promise<{ entrou: number }> {
    try {
        return await entrar(evento)
    } catch (erro) {
        log.error(
            `gatilho ${evento.tipo} para o contato ${evento.contactId} falhou`,
            erro instanceof Error ? erro.message : erro
        )
        return { entrou: 0 }
    }
}

async function entrar(evento: EventoDeGatilho): Promise<{ entrou: number }> {
    /**
     * Sem motor registrado, **nada** é criado.
     *
     * Criar a linha sem instância deixaria uma passagem `running` que não anda —
     * e a trava parcial `WHERE status = 'running'` impediria a pessoa de entrar
     * de novo enquanto aquela linha existisse. Pior que não entrar: entrar e
     * ficar preso.
     */
    if (!temMotorDoFunil()) {
        log.warn('nenhum motor de funil registrado; nenhuma passagem foi criada')
        return { entrou: 0 }
    }

    const candidatos = await prisma.funnel.findMany({
        where: {
            workspaceId: evento.workspaceId,
            status: 'published',
            // A entrada manual tem destinatário: ver `apenasFunil` em gatilho.ts.
            ...(evento.apenasFunil ? { id: evento.apenasFunil } : {}),
        },
        select: {
            id: true,
            name: true,
            trigger: true,
            version: true,
            maxAtivos: true,
            steps: {
                select: { id: true, type: true, config: true, order: true, edges: true },
                orderBy: { order: 'asc' },
            },
        },
    })

    let entrou = 0

    for (const funil of candidatos) {
        const gatilho = lerGatilho(funil.trigger)
        // Gatilho ilegível é "não entra ninguém", nunca "entra todo mundo".
        if (!gatilho || !casa(gatilho, evento)) continue

        /**
         * Funil publicado sem passo nenhum não recebe gente.
         *
         * Entrar num desenho vazio criaria passagem que nasce e conclui na
         * mesma volta, e a tela mostraria dezenas de passagens "concluídas" sem
         * uma mensagem ter saído.
         */
        if (!primeiroPasso(funil.steps)) {
            log.warn(`funil ${funil.id} está publicado e sem passos; ninguém entra`)
            continue
        }

        /**
         * Ciclo barra a entrada, mesmo publicado.
         *
         * A publicação já recusa ciclo, mas um `edges` editado direto no banco —
         * ou um funil publicado antes dessa guarda existir — chegaria aqui com
         * laço. O motor tem o teto de transições como rede, e a rede custa
         * mensagens: ela só corta depois de 200 voltas. Barrar na entrada custa
         * zero.
         */
        const ciclo = cicloNoDesenho(funil.steps)
        if (ciclo) {
            log.error(
                `funil ${funil.id} tem ciclo no desenho (${ciclo.join(' → ')}); ninguém entra`
            )
            continue
        }

        if (!(await cabeNoTeto(funil.id, funil.maxAtivos))) continue

        const criada = await criarPassagem(funil.id, funil.version, evento.contactId)
        if (criada) entrou++
    }

    return { entrou }
}

/**
 * O teto de ativos do funil.
 *
 * `null` = sem teto. O teto conta **só quem está `running`**: ele existe para
 * limitar quanto o funil manda ao mesmo tempo, não quantas pessoas já passaram
 * por ele. Contar as concluídas faria o funil se fechar sozinho com o tempo, e
 * o motivo não apareceria em lugar nenhum.
 *
 * Não é trava atômica, e não precisa ser: o teto é rédea de volume, e dois
 * gatilhos simultâneos no limite deixam entrar um a mais. Transação por aqui
 * custaria uma serialização em todo gatilho para evitar um erro de um.
 */
async function cabeNoTeto(funnelId: string, maxAtivos: number | null): Promise<boolean> {
    if (maxAtivos === null || maxAtivos <= 0) return true

    const ativos = await prisma.funnelRun.count({ where: { funnelId, status: 'running' } })
    if (ativos < maxAtivos) return true

    log.info(`funil ${funnelId} está no teto (${ativos}/${maxAtivos}); a entrada foi recusada`)
    return false
}

/**
 * Cria a linha e a instância, **nessa ordem**, e desfaz a linha se a instância
 * não vier.
 *
 * A ordem não é arbitrária. A instância precisa do `runId` no payload, então a
 * linha vem primeiro — e isso abre a janela em que a linha existe sem instância.
 * A janela é de milissegundos (é o que o comentário da migração diz sobre
 * `instanceId` nulo), mas se a criação falhar ela não fecha sozinha: a trava
 * parcial deixaria aquele contato preso fora do funil para sempre, sem nada na
 * tela explicando.
 *
 * Então o `catch` apaga a linha. Apagar é certo aqui e seria errado em quase
 * todo outro lugar: a linha não chegou a significar nada — nenhuma mensagem
 * saiu, nenhum passo andou — e deixá-la como `failed` seria registrar uma
 * passagem que nunca começou.
 */
async function criarPassagem(
    funnelId: string,
    version: number,
    contactId: string
): Promise<boolean> {
    let runId: string

    try {
        const run = await prisma.funnelRun.create({
            data: { funnelId, contactId, version, status: 'running' },
            select: { id: true },
        })
        runId = run.id
    } catch {
        /**
         * A trava parcial recusou: esta pessoa já está dentro deste funil.
         *
         * É o caminho **esperado** quando a etiqueta é aplicada duas vezes, e
         * por isso é `debug` e não erro. Distinguir isso de falha de banco pelo
         * código do erro seria mais preciso e não vale: o desfecho é o mesmo —
         * ninguém entra — e tratar falha de banco como "já está dentro" só
         * atrasa a entrada até o gatilho seguinte.
         */
        log.debug(`contato ${contactId} já está no funil ${funnelId}; nada a criar`)
        return false
    }

    try {
        const instanceId = await criarInstanciaDoFunil(runId)
        await prisma.funnelRun.update({ where: { id: runId }, data: { instanceId } })
        return true
    } catch (erro) {
        await prisma.funnelRun.delete({ where: { id: runId } }).catch(() => {})
        log.error(
            `funil ${funnelId}: a instância não foi criada e a passagem foi desfeita`,
            erro instanceof Error ? erro.message : erro
        )
        return false
    }
}
