import type { Contact, Conversation } from '@venn/db'
import prisma from '@venn/db/cliente'
import { darDono } from '../../lib/conversas/dono'
import { phoneVariants } from '../../lib/whatsapp/types'
import { withLock } from '../trava'
import { createLogger } from '../registro'

const log = createLogger('CONVERSATION')

/**
 * Quem é o paciente no canal por onde ele escreveu.
 *
 * O WhatsApp identifica por telefone; o Instagram, por um **IGSID** — um id de
 * dezessete dígitos escopado ao nosso aplicativo da Meta, que não é telefone
 * nem se parece com um. Antes disto, `phone` era a identidade única do inbound,
 * e um IGSID ali entraria na busca por telefone, apareceria formatado como
 * celular na ficha e passaria pela regra do nono dígito.
 */
export type ContactIdentity =
    | { kind: 'phone'; value: string }
    | { kind: 'instagram'; value: string }

/**
 * O nome que a ficha do Instagram recebe até o perfil ser consultado.
 *
 * Exportado porque `syncContactProfile` precisa reconhecê-lo para saber que
 * pode substituí-lo — e um literal repetido nos dois arquivos deixaria de
 * casar na primeira vez que alguém reescrevesse um dos dois.
 */
export const NOME_PROVISORIO_INSTAGRAM = 'Instagram (sem nome ainda)'

/** A chave do bloqueio por paciente. */
function lockKeyFor(workspaceId: string, identity: ContactIdentity): string {
    // O WhatsApp mantém a chave antiga: trocá-la faria, durante um deploy, dois
    // processos usarem chaves diferentes para o mesmo paciente.
    return identity.kind === 'phone'
        ? `contact:${workspaceId}:${identity.value}`
        : `contact:${workspaceId}:ig:${identity.value}`
}

export interface ResolveContactInput {
    workspaceId: string
    identity: ContactIdentity
    /** A linha por onde ele escreveu — é dela que sai a origem da ficha nova. */
    integrationId: string
    pushName?: string | null
    profilePicUrl?: string | null
}

/**
 * A origem que esta linha semeia, se a clínica disse qual é.
 *
 * Consultada **só quando a ficha vai nascer**, e não a cada mensagem: a origem
 * não se reescreve depois, então o valor não interessa para quem já é paciente.
 *
 * É esta consulta que faz a atribuição funcionar sem ninguém digitar nada. O
 * WhatsApp QR da V4 e o do Nando são os dois `whatsapp_qr` — o canal não
 * distingue, a conversa não distingue, e o que distingue é o número para onde
 * o anúncio da agência mandou o paciente.
 */
async function marketingDaLinha(
    integrationId: string
): Promise<{ originId: string | null; mediaId: string | null }> {
    const linha = await prisma.agentIntegration.findUnique({
        where: { id: integrationId },
        select: { defaultOriginId: true, defaultMediaId: true },
    })
    return {
        originId: linha?.defaultOriginId ?? null,
        /**
         * A mídia entra junto desde 2026-10-20.
         *
         * Origem diz **de quem** veio o lead (a agência, o indicador); mídia
         * diz **o quê** o trouxe (a campanha, a peça). A linha é quem sabe as
         * duas: ela é o número para onde aquele anúncio manda.
         */
        mediaId: linha?.defaultMediaId ?? null,
    }
}

/**
 * Find or create the contact for an inbound message, keeping the display name
 * and avatar fresh.
 *
 * Callers must already hold the per-contact lock (see `resolveInboundContext`).
 */
async function resolveContact(input: ResolveContactInput): Promise<Contact> {
    const { workspaceId, identity, integrationId, pushName, profilePicUrl } = input

    if (identity.kind === 'instagram') {
        return resolveInstagramContact(workspaceId, identity.value, integrationId, pushName, profilePicUrl)
    }

    const phone = identity.value

    /**
     * As duas formas do celular brasileiro, porque uma ficha pode ter nascido
     * com a outra.
     *
     * Quem cadastra à mão digita `(31) 98850-1161`; a conta no WhatsApp pode
     * estar registrada como `553188501161`, sem o nono dígito, e é essa forma
     * que chega aqui pelo JID. Procurando só pela forma exata, a primeira
     * mensagem criava um segundo paciente ao lado do que a recepção acabara de
     * cadastrar.
     */
    const existing = await prisma.contact.findFirst({
        where: { workspaceId, phone: { in: phoneVariants(phone) } },
    })

    if (!existing) {
        return prisma.contact.create({
            data: {
                workspaceId,
                phone,
                name: pushName || `WhatsApp ${phone}`,
                avatar: profilePicUrl ?? null,
                // `inbound`: ele escreveu primeiro. Antes era `whatsapp`, que é
                // o canal — e o canal já está na conversa, gravado na linha.
                createdVia: 'inbound',
                /** A ficha guarda origem; mídia é do negócio (ver `Media`). */
                originId: (await marketingDaLinha(integrationId)).originId,
            },
        })
    }

    const patch: { name?: string; avatar?: string; phone?: string } = {}
    if (pushName && existing.name !== pushName) patch.name = pushName
    if (profilePicUrl && existing.avatar !== profilePicUrl) patch.avatar = profilePicUrl
    // O JID é a autoridade sobre a forma do número: convergir a ficha para ela
    // evita que a próxima busca exata erre de novo. Se as duas formas existirem
    // como fichas separadas (dado antigo), o índice único recusa — e aí a ficha
    // fica como está, que é melhor que abortar a mensagem.
    if (existing.phone !== phone) patch.phone = phone

    if (Object.keys(patch).length === 0) return existing
    try {
        return await prisma.contact.update({ where: { id: existing.id }, data: patch })
    } catch {
        log.warn(`could not converge contact ${existing.id} to ${phone}; keeping as is`)
        return existing
    }
}

/**
 * A ficha de quem escreveu pelo Direct.
 *
 * Sem variação a procurar: o IGSID é exato, ou é outro paciente. E **sem
 * telefone** — o Direct não dá o número de ninguém, e inventar um valor ali
 * para preencher a coluna criaria uma ficha que a busca por telefone acharia
 * por engano.
 *
 * O nome nasce provisório: o webhook do Instagram não manda o nome de quem
 * escreveu, só o id. Quem o troca pelo @ da conta é a busca de perfil, logo
 * depois, em segundo plano — ver `syncContactProfile`.
 */
async function resolveInstagramContact(
    workspaceId: string,
    instagramId: string,
    integrationId: string,
    pushName?: string | null,
    profilePicUrl?: string | null
): Promise<Contact> {
    const existing = await prisma.contact.findFirst({ where: { workspaceId, instagramId } })

    if (!existing) {
        return prisma.contact.create({
            data: {
                workspaceId,
                instagramId,
                name: pushName || NOME_PROVISORIO_INSTAGRAM,
                avatar: profilePicUrl ?? null,
                createdVia: 'inbound',
                originId: (await marketingDaLinha(integrationId)).originId,
            },
        })
    }

    const patch: { name?: string; avatar?: string } = {}
    if (pushName && existing.name !== pushName) patch.name = pushName
    if (profilePicUrl && existing.avatar !== profilePicUrl) patch.avatar = profilePicUrl

    if (Object.keys(patch).length === 0) return existing
    return prisma.contact.update({ where: { id: existing.id }, data: patch })
}

/**
 * Drop every new inbound contact into the first pipeline stage, so inbound
 * new patients show up on the Negócios board without manual entry.
 *
 * O negócio herda a origem da ficha, que é a lista única da clínica. Antes ele
 * gravava o **canal** (`whatsapp`) num campo chamado origem, e aí o funil
 * respondia "de onde vêm nossos negócios? WhatsApp" — que é por onde eles
 * escrevem, e não diz nada sobre o que os trouxe.
 *
 * Non-fatal: a workspace with no pipeline stages yet simply gets no deal.
 */
async function ensureOpenDeal(
    workspaceId: string,
    contact: Contact,
    /** A mídia que a linha semeia, quando ela semeia alguma. */
    mediaId: string | null
): Promise<void> {
    const openDeal = await prisma.deal.findFirst({
        where: { contactId: contact.id, workspaceId, status: 'open' },
        select: { id: true },
    })
    if (openDeal) return

    const firstStage = await prisma.pipelineStage.findFirst({
        where: { workspaceId },
        orderBy: { order: 'asc' },
        select: { id: true },
    })
    if (!firstStage) {
        log.warn(`workspace ${workspaceId} has no pipeline stages; skipping deal creation`)
        return
    }

    /**
     * A primeira passagem nasce junto com o negócio.
     *
     * Sem ela o negócio criado pelo WhatsApp entrava no funil sem jornada: a
     * primeira fase ficava sem data e sem marca, "dias nesta fase" caía no
     * `createdAt` e a régua de follow-up contava de lá. Quem cria negócio pela
     * tela e pelo intake já gravava a passagem; só este caminho não gravava, e
     * é o caminho por onde entra a maioria dos pacientes.
     */
    const deal = await prisma.deal.create({
        data: {
            workspaceId,
            contactId: contact.id,
            // Sem o `instagramId` no fim, um paciente do Direct viraria
            // "Novo paciente - null": lá o telefone não existe.
            title: `Novo paciente - ${contact.name || contact.phone || contact.instagramId}`,
            stageId: firstStage.id,
            originId: contact.originId,
            /**
             * A mídia vem da **linha**, não da ficha: `Media` pende do negócio,
             * porque a mesma pessoa pode voltar por outra campanha e cada
             * negócio guarda a sua. A ficha guarda só a origem, que é de quem
             * ela veio da primeira vez.
             */
            mediaId,
            status: 'open',
            // `userId` nulo: não foi pessoa nenhuma que moveu, foi a mensagem
            // do paciente chegando.
            stageEntries: { create: { stageId: firstStage.id } },
        },
    })
    log.info(`auto-created deal ${deal.id} for contact ${contact.id}`)
}

/**
 * Get the conversation to append to: the open one on this line, the most recent
 * closed one reopened, or a brand new one.
 *
 * **Scoped by line, not only by patient.** Antes era workspace + paciente e mais
 * nada: um paciente que escrevesse para dois números da mesma clínica — duas
 * unidades, dois consultórios — caía num fio só, e a resposta saía pela linha
 * que o `findFirst` devolvesse primeiro, que podia ser a outra. O paciente
 * recebia da unidade errada, e o histórico das duas unidades virava um só.
 *
 * Um fio por linha é também o que permite a tela filtrar por linha e a resposta
 * manual sair pelo número certo.
 */
async function resolveConversation(
    workspaceId: string,
    contactId: string,
    agentId: string,
    integrationId: string,
    channel: string
): Promise<Conversation> {
    const open = await prisma.conversation.findFirst({
        where: { workspaceId, contactId, integrationId, status: { not: 'closed' } },
    })
    if (open) return open

    /**
     * Um fio aberto e sem linha é adotado por esta.
     *
     * É o caso da recepção: "Novo atendimento" abre a conversa antes de o
     * paciente escrever, e aí ainda não há linha nenhuma. Quando ele responde, o
     * fio que a atendente está olhando é este — criar um segundo ao lado
     * dividiria a mesma conversa em duas. O mesmo vale para o histórico cuja
     * linha a migração não conseguiu deduzir.
     */
    const unlinked = await prisma.conversation.findFirst({
        where: { workspaceId, contactId, integrationId: null, status: { not: 'closed' } },
        orderBy: { lastMessageAt: 'desc' },
    })
    if (unlinked) {
        const adopted = await prisma.conversation.update({
            where: { id: unlinked.id },
            data: { integrationId, agentId },
        })
        log.info(`conversation ${adopted.id} adopted by line ${integrationId}`)
        return adopted
    }

    const closed = await prisma.conversation.findFirst({
        where: {
            workspaceId,
            contactId,
            status: 'closed',
            OR: [{ integrationId }, { integrationId: null }],
        },
        orderBy: { updatedAt: 'desc' },
    })

    if (closed) {
        /**
         * Reabrir devolve a conversa ao agente — **sem tocar em quem ela é.**
         *
         * O portão volta a `bot`, e é ele que faz o agente falar primeiro. Era
         * para isso que `assignedTo` era zerado aqui, e zerá-lo era a única
         * forma de dizer "o bot assume" quando as duas perguntas moravam na
         * mesma coluna.
         *
         * Agora `assignedTo` simplesmente **não aparece neste `data`** — fica
         * como está. É o que a decisão registrada no schema sempre pediu:
         * "quando o paciente volta a escrever depois de finalizada, quem já
         * falou com ele continua respondendo por ele". A versão anterior desta
         * linha repunha o responsável a partir de `ownerId`; não precisa mais,
         * porque ele nunca saiu de `assignedTo`.
         */
        const reopened = await prisma.conversation.update({
            where: { id: closed.id },
            data: {
                status: 'active',
                agentId,
                integrationId,
                /**
                 * E o portão volta ao bot.
                 *
                 * Pela mesma razão que `assignedTo` zera: é atendimento novo, e
                 * quem fala primeiro é o agente. Sem isto, um paciente atendido
                 * por gente uma vez voltaria meses depois direto para a aba da
                 * equipe, sem ninguém avisado e sem o agente responder.
                 */
                atendidaPor: 'bot',
                /**
                 * E a entrega anterior também sai.
                 *
                 * `handoffAt` cala o agente. Sem limpá-lo aqui, um paciente cujo
                 * atendimento foi entregue à equipe uma vez voltaria meses depois
                 * para **nenhuma** resposta automática, para sempre — a conversa é
                 * reaberta na mesma linha, não recriada. É o mesmo raciocínio que
                 * já limpa o aviso automático logo abaixo.
                 */
                handoffAt: null,
                handoffReason: null,
                /**
                 * Reabrir limpa o aviso automático, porque é outro atendimento.
                 *
                 * `claimAutoNotice` recusa repetir o mesmo aviso na mesma
                 * conversa, para sempre. Sem limpar aqui, um paciente que já
                 * esgotou o limite de interações uma vez teria a segunda entrega
                 * à equipe feita **em silêncio** — a conversa pararia de ser
                 * respondida sem que ninguém lhe dissesse que uma pessoa ia
                 * continuar. Idem para o aviso de crédito.
                 */
                autoNoticeAt: null,
                autoNoticeKind: null,
            },
        })
        log.info(`reopened conversation ${reopened.id}`)
        return reopened
    }

    const criada = await prisma.conversation.create({
        data: {
            workspaceId,
            agentId,
            integrationId,
            contactId,
            channel,
            status: 'active',
        },
    })

    /**
     * A conversa nova ganha **dono** — quem responde por ela, não quem a assumiu.
     *
     * Não mexe em `assignedTo`: aquele é o mutex do agente, e gravá-lo aqui
     * calaria o bot no ato de distribuir, que é o oposto do pedido. O agente
     * segue atendendo, e a conversa continua em "Em espera" — agora com
     * responsável visível.
     *
     * Depois do `create` e não dentro dele porque a escolha precisa de duas
     * agregações; prendê-las na mesma escrita atrasaria a entrada da mensagem
     * por uma melhoria. `darDono` nunca lança e é idempotente — se a conta não
     * configurou distribuição, devolve null e nada muda.
     *
     * **Reabrir não redistribui**, de propósito: o `ownerId` sobrevive porque o
     * dono é da relação com o paciente, não do turno. Quem já falou com ele
     * continua respondendo por ele. Ver §11.2 do estudo.
     */
    await darDono({
        workspaceId,
        conversationId: criada.id,
        integrationId,
    })

    return criada
}

export interface InboundContext {
    contact: Contact
    conversation: Conversation
}

/**
 * Resolve contact, deal and conversation for an inbound message as one
 * serialised unit.
 *
 * The lock is keyed on workspace + a identidade do paciente no canal, que é
 * exatamente o escopo de unicidade que webhooks concorrentes violavam. Deal creation runs inside the lock
 * too, because two parallel jobs would otherwise both see "no open deal".
 */
export async function resolveInboundContext(input: {
    workspaceId: string
    agentId: string
    /** A linha por onde a mensagem chegou — é o que separa os fios. */
    integrationId: string
    /** Quem escreveu, no vocabulário do canal. Ver `ContactIdentity`. */
    identity: ContactIdentity
    /** O canal da conversa: "whatsapp" ou "instagram". */
    channel: string
    pushName?: string | null
    profilePicUrl?: string | null
}): Promise<InboundContext> {
    const { workspaceId, agentId, integrationId, identity, channel, pushName, profilePicUrl } =
        input

    return withLock(
        lockKeyFor(workspaceId, identity),
        async () => {
            const contact = await resolveContact({ workspaceId, identity, integrationId, pushName, profilePicUrl })

            try {
                await ensureOpenDeal(
                    workspaceId,
                    contact,
                    (await marketingDaLinha(integrationId)).mediaId
                )
            } catch (error) {
                // A missing deal must not cost us the message.
                log.error(`failed to auto-create deal for contact ${contact.id}`, error)
            }

            const conversation = await resolveConversation(
                workspaceId,
                contact.id,
                agentId,
                integrationId,
                channel
            )
            return { contact, conversation }
        },
        { ttlMs: 20_000, waitMs: 15_000 }
    )
}

/**
 * O agente tem de ficar calado nesta conversa?
 *
 * **Uma coluna, e é a que foi feita para responder isto:** `atendidaPor`.
 *
 * ## O que havia antes, e por que doía
 *
 * Era `Boolean(assignedTo) || Boolean(handoffAt)` — duas colunas, nenhuma das
 * duas sobre "quem está conduzindo". `assignedTo` é *quem é a pessoa*, e usá-lo
 * como mutex amarrou as duas perguntas num campo só. A consequência media-se:
 * **o rodízio não podia escrever `assignedTo`**, porque distribuir calaria o
 * agente no ato de distribuir. Então ele escrevia `ownerId`, uma coluna que a
 * lista não lia — e o lead chegava, ganhava responsável, e não aparecia nas
 * "Minhas" de ninguém. Foi o defeito que o Andre relatou nessas palavras, e
 * medi em produção no primeiro lead depois do deploy do portão: `ownerId` =
 * Rachel, `assignedTo` nulo.
 *
 * `handoffAt` entrou na conjunção para tapar o outro buraco: a entrega sem
 * destino não atribuía ninguém, e o agente respondia por cima da própria
 * despedida. Com o portão, entregar grava `atendidaPor = 'humano'` e o caso
 * desaparece — não é mais preciso conjugar duas colunas para ter um estado.
 *
 * ## O que esta troca libera
 *
 * Com o mutex aqui, `assignedTo` volta a responder **uma** pergunta, e o
 * rodízio pode escrevê-lo. É a condição de `darDono` gravar o responsável onde
 * a tela o procura.
 *
 * O tipo é estrutural, e não `Conversation`, porque os chamadores fazem `select`
 * de duas ou três colunas: exigir a entidade inteira obrigaria a trazer o resumo
 * da conversa e o histórico de avisos num caminho quente.
 */
export function isHumanHandled(conversation: { atendidaPor: string }): boolean {
    return conversation.atendidaPor === 'humano'
}
