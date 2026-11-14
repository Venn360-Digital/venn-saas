import 'server-only'
import prisma from '@venn/db/cliente'
import { lerBlocos } from '../email/blocos'
import {
    canalDoPasso,
    deveParar,
    lerCondicao,
    type CanalDoPasso,
    type Condicao,
    type EstadoDoContato,
    type MotivoDeParada,
    type PassoDoFunil,
} from './passos'

/**
 * O que o motor do funil **lê** do banco.
 *
 * A decisão mora em `passos.ts`, que é pura. Este módulo é o outro lado: ele
 * busca os fatos e os entrega naquela forma. A separação é o que permite provar
 * a navegação, a espera e os freios em `npx tsx` nesta máquina, onde o workerd
 * não roda — e deixa aqui apenas consultas, que são conferíveis por leitura.
 *
 * Nenhum `where` sem `workspaceId`. Vale dobrado aqui: o motor acorda de uma
 * instância de Workflow que dormiu até um ano, com um `runId` como única
 * entrada, e o workspace vem **do funil**, não do payload.
 */

export interface Passagem {
    runId: string
    workspaceId: string
    funnelId: string
    contactId: string
    /** A versão com que a pessoa entrou. Publicar de novo não muda quem já está dentro. */
    version: number
    funilPublicado: boolean
    startedAt: Date
    passos: PassoDoFunil[]
    /** `null` quando o contato foi apagado depois de a passagem começar. */
    contato: { id: string; name: string | null; email: string | null; phone: string | null } | null
    emailOptOut: boolean
    autoMessagesPausadas: boolean
}

/**
 * Carrega tudo o que uma volta do motor precisa, numa consulta.
 *
 * Uma e não cinco porque cada volta do laço paga o ida-e-volta ao Neon
 * (~110 ms medidos, ver a nota de desempenho do projeto), e um funil de dez
 * passos daria cinquenta viagens.
 */
export async function lerPassagem(runId: string): Promise<Passagem | null> {
    const run = await prisma.funnelRun.findUnique({
        where: { id: runId },
        select: {
            id: true,
            contactId: true,
            version: true,
            startedAt: true,
            funnel: {
                select: {
                    id: true,
                    workspaceId: true,
                    status: true,
                    steps: {
                        select: { id: true, type: true, config: true, order: true, edges: true },
                        orderBy: { order: 'asc' },
                    },
                },
            },
            contact: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    emailOptOutAt: true,
                    autoMessagesPausedAt: true,
                    workspaceId: true,
                },
            },
        },
    })

    if (!run) return null

    /**
     * O contato pode ter sido apagado — `contactId` é cascade, então a linha da
     * passagem iria com ele e `run` seria nulo. Mas o contato pode também ter
     * **mudado de workspace** num cenário de correção manual, e aí o cruzamento
     * importa: um contato de outra unidade não pode ser lido por este funil.
     */
    const contato =
        run.contact && run.contact.workspaceId === run.funnel.workspaceId ? run.contact : null

    return {
        runId: run.id,
        workspaceId: run.funnel.workspaceId,
        funnelId: run.funnel.id,
        contactId: run.contactId,
        version: run.version,
        funilPublicado: run.funnel.status === 'published',
        startedAt: run.startedAt,
        passos: run.funnel.steps,
        contato: contato
            ? { id: contato.id, name: contato.name, email: contato.email, phone: contato.phone }
            : null,
        emailOptOut: Boolean(contato?.emailOptOutAt),
        autoMessagesPausadas: Boolean(contato?.autoMessagesPausedAt),
    }
}

/**
 * Deve parar? Monta o estado e pergunta à função pura.
 *
 * O canal entra porque o opt-out é **por canal**: quem pediu para não receber
 * e-mail de divulgação não pediu para parar de receber WhatsApp, e o contrário
 * também vale. Tratar os dois como um só silenciaria metade do funil sem que
 * ninguém tivesse pedido.
 */
export async function freioDaPassagem(
    passagem: Passagem,
    canal: CanalDoPasso
): Promise<MotivoDeParada | null> {
    const estado: EstadoDoContato = {
        humanoAssumiu: await humanoAssumiu(passagem.workspaceId, passagem.contactId),
        optOutNoCanal:
            canal === 'email' ? passagem.emailOptOut : passagem.autoMessagesPausadas,
        funilPublicado: passagem.funilPublicado,
        contatoExiste: passagem.contato !== null,
    }
    return deveParar(estado)
}

/**
 * Alguém da equipe assumiu alguma conversa deste contato?
 *
 * `atendidaPor === 'humano'` e **só** isso — ver a nota longa em
 * `deveParar`. `assignedTo` é escrito pelo rodízio na chegada da mensagem,
 * então parar por ele mataria o funil em toda clínica que distribui
 * automaticamente, que é o caso normal.
 *
 * Conversa **fechada** não conta: a pessoa atendeu, resolveu e encerrou; o funil
 * de retorno dali a trinta dias é exatamente o que se quer que aconteça.
 */
async function humanoAssumiu(workspaceId: string, contactId: string): Promise<boolean> {
    const quantas = await prisma.conversation.count({
        where: {
            workspaceId,
            contactId,
            atendidaPor: 'humano',
            status: { not: 'closed' },
        },
    })
    return quantas > 0
}

// ──────────────────────────── A condição ────────────────────────────

/**
 * Avalia uma condição contra fatos do banco.
 *
 * Condição que não dá para ler (`lerCondicao` devolve nulo) vale **falso**, e
 * falso é o ramo seguro: o funil segue pelo "não", que no desenho normal é o
 * caminho que não manda nada. O contrário — config inválida indo pelo "sim" —
 * faria a promoção sair para quem a condição existia justamente para excluir.
 */
export async function avaliarCondicao(
    passagem: Passagem,
    config: unknown
): Promise<{ ramo: 'sim' | 'nao'; condicao: Condicao | null }> {
    const condicao = lerCondicao(config)
    if (!condicao) return { ramo: 'nao', condicao: null }

    const verdade = await responde(passagem, condicao)
    return { ramo: verdade ? 'sim' : 'nao', condicao }
}

async function responde(passagem: Passagem, condicao: Condicao): Promise<boolean> {
    const { workspaceId, contactId } = passagem

    switch (condicao.campo) {
        /**
         * Respondeu **desde que entrou no funil**, não "algum dia".
         *
         * Sem o corte por data, todo contato que já trocou mensagem com a
         * clínica responderia "sim" na primeira condição, e o ramo do "não"
         * nunca aconteceria. A data é `startedAt` da passagem.
         */
        case 'respondeu': {
            const quantas = await prisma.message.count({
                where: {
                    direction: 'inbound',
                    createdAt: { gt: passagem.startedAt },
                    conversation: { workspaceId, contactId },
                },
            })
            return quantas > 0
        }

        case 'tem_negocio_aberto': {
            const quantos = await prisma.deal.count({
                where: { workspaceId, contactId, status: 'open' },
            })
            return quantos > 0
        }

        case 'tem_etiqueta': {
            const quantas = await prisma.contactTag.count({
                // `contact.workspaceId` e não só `contactId`: o id vem do
                // desenho do funil, que é dado de entrada.
                where: { contactId, tagId: condicao.valor, contact: { workspaceId } },
            })
            return quantas > 0
        }

        case 'etapa_do_negocio': {
            const quantos = await prisma.deal.count({
                where: { workspaceId, contactId, stageId: condicao.valor },
            })
            return quantos > 0
        }
    }
}

// ─────────────────────────── O remetente ───────────────────────────

export interface RemetenteDoFunil {
    de: string
    nomeDoRemetente: string
    replyTo: string
    configurationSet: string | null
}

/**
 * O remetente verificado da unidade, ou `null`.
 *
 * `null` **para** o passo de e-mail com motivo claro, em vez de cair num
 * remetente nosso. Mandar campanha de `venn360.com` em nome da clínica é o
 * contrário de toda a decisão de arquitetura desta feature: a reputação tem de
 * ficar no domínio de quem manda.
 */
export async function remetenteDoFunil(workspaceId: string): Promise<RemetenteDoFunil | null> {
    const r = await prisma.emailSender.findFirst({
        where: { workspaceId, status: 'verified' },
        orderBy: { verifiedAt: 'asc' },
        select: {
            domain: true,
            fromLocal: true,
            fromName: true,
            replyTo: true,
            configurationSetName: true,
        },
    })
    if (!r) return null

    return {
        de: `${r.fromLocal}@${r.domain}`,
        nomeDoRemetente: r.fromName,
        replyTo: r.replyTo,
        configurationSet: r.configurationSetName,
    }
}

/**
 * O conteúdo de um passo de e-mail.
 *
 * O passo guarda `templateId` **ou** o conteúdo solto. O template vence quando
 * os dois existem: se alguém ligou um modelo ao nó, é o modelo que a tela está
 * mostrando.
 */
export async function conteudoDoPasso(
    workspaceId: string,
    config: unknown
): Promise<{ assunto: string; preheader: string | null; blocos: ReturnType<typeof lerBlocos> } | null> {
    const c = typeof config === 'object' && config !== null ? (config as Record<string, unknown>) : {}
    const templateId = typeof c.templateId === 'string' && c.templateId ? c.templateId : null

    if (templateId) {
        const t = await prisma.emailTemplate.findFirst({
            where: { id: templateId, workspaceId },
            select: { subject: true, preheader: true, blocks: true },
        })
        /**
         * `EmailTemplate.subject` é opcional no schema, então template sem
         * assunto é estado possível — e e-mail sem assunto cai em spam. Vale
         * como "passo sem conteúdo", que o motor reporta com motivo.
         */
        if (!t || !t.subject?.trim()) return null
        return { assunto: t.subject.trim(), preheader: t.preheader, blocos: lerBlocos(t.blocks) }
    }

    const assunto = typeof c.assunto === 'string' ? c.assunto.trim() : ''
    if (!assunto) return null
    return {
        assunto,
        preheader: typeof c.preheader === 'string' ? c.preheader : null,
        blocos: lerBlocos(c.blocos),
    }
}

/** O canal de um passo, reexportado para o motor não importar dois módulos. */
export { canalDoPasso }
