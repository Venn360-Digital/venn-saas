import prisma from '@/lib/prisma'
import { createLogger } from '../logger'

const log = createLogger('CONTEXT')

/** O fuso de quem nunca escolheu — o mesmo que o código usava fixo. */
const TZ_PADRAO = 'America/Sao_Paulo'

export interface ConversationContext {
    /**
     * De quem é esta conversa.
     *
     * Não entra no prompt: é o que as ferramentas usam para saber sobre quem
     * consultar a agenda e qual negócio mover. Sem ele cada ferramenta teria de
     * ir ao banco de novo para descobrir o que esta função já sabe.
     */
    contactId?: string
    /** Como chamar a pessoa. Primeiro nome, que é como se fala no WhatsApp. */
    contactFirstName?: string
    contactFullName?: string
    /** A fase do funil em que o negócio aberto está, se houver. */
    dealStage?: string
    dealTitle?: string
    /** Os próximos compromissos desta pessoa, do mais próximo para o mais distante. */
    upcoming: { quando: string; titulo: string }[]
    /**
     * As fases do funil desta clínica, na ordem.
     *
     * Vão para o prompt porque a ferramenta `mover_negocio` só aceita o nome
     * exato de uma delas: sem a lista à vista, o modelo chuta um nome plausível
     * ("Qualificação") que a clínica não tem, e a ferramenta recusa.
     */
    stages: string[]
    /**
     * Os procedimentos que o agente pode marcar, e com quem.
     *
     * Mesma razão das fases: `marcar_consulta` exige o nome exato. E sem saber o
     * que existe, o modelo promete "limpeza" numa clínica que só cadastrou
     * avaliação — que é pior que não marcar, porque o paciente já desligou
     * achando que tinha horário.
     */
    bookable: { procedimentos: string[]; especialistas: string[] }
    /** Data e hora de agora, por extenso, no fuso da clínica. */
    agora: string
}

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

/** "quinta-feira, 13 de outubro de 2026, 19:42" */
function porExtenso(data: Date, tz: string): string {
    const partes = new Intl.DateTimeFormat('pt-BR', {
        timeZone: tz,
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(data)
    return partes
}

/** "sexta-feira, 17/10, às 14:30" — curto, porque vai para dentro do prompt. */
function quandoCurto(dueDate: Date, startTime: string | null, tz: string): string {
    const dia = new Intl.DateTimeFormat('pt-BR', {
        timeZone: tz,
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
    }).format(dueDate)
    return startTime ? `${dia}, às ${startTime}` : dia
}

/**
 * O que o agente precisa saber sobre *esta* conversa, além do que ele sabe sobre
 * a clínica.
 *
 * Até aqui o prompt descrevia a empresa e nada mais: o agente não sabia o nome de
 * quem estava do outro lado, nem que a pessoa já tinha consulta marcada para
 * sexta, nem em que ponto do funil ela estava. Respondia a todo paciente como se
 * fosse o primeiro contato — e perguntava de novo o que a clínica já tinha
 * registrado.
 *
 * Falhar aqui não cala o agente: devolve o mínimo (a data) e segue, porque uma
 * resposta sem o nome do paciente é muito melhor que nenhuma resposta.
 */
export async function loadConversationContext(
    conversationId: string,
    timezone: string = TZ_PADRAO
): Promise<ConversationContext> {
    const agora = porExtenso(new Date(), timezone)

    try {
        const conversa = await prisma.conversation.findUnique({
            where: { id: conversationId },
            select: {
                workspaceId: true,
                contact: { select: { id: true, name: true } },
            },
        })

        if (!conversa?.contact) return { upcoming: [], stages: [], bookable: { procedimentos: [], especialistas: [] }, agora }

        const { contact, workspaceId } = conversa

        // O nome de exibição do WhatsApp entra como "WhatsApp 553199..." quando a
        // pessoa não tem nome definido; isso não é nome de gente e não ajuda o
        // modelo a tratar ninguém pelo nome.
        const nome = contact.name && !/^WhatsApp\s/i.test(contact.name) ? contact.name.trim() : undefined

        const [negocio, compromissos, fases, procedimentos, especialistas] = await Promise.all([
            prisma.deal.findFirst({
                where: { workspaceId, contactId: contact.id, status: 'open' },
                orderBy: { createdAt: 'desc' },
                select: { title: true, stage: { select: { name: true } } },
            }),
            prisma.activity.findMany({
                where: {
                    workspaceId,
                    contactId: contact.id,
                    completedAt: null,
                    dueDate: { gte: new Date() },
                },
                orderBy: { dueDate: 'asc' },
                take: 3,
                select: { title: true, dueDate: true, startTime: true },
            }),
            prisma.pipelineStage.findMany({
                where: { workspaceId },
                orderBy: { order: 'asc' },
                select: { name: true },
            }),
            /**
             * Só o que o agente pode de fato marcar.
             *
             * Um procedimento sem duração não dá para reservar, e um que nenhuma
             * janela liberada aceita ele não vai conseguir marcar — listar
             * qualquer um dos dois no prompt seria convidá-lo a prometer o que
             * não cumpre.
             */
            prisma.productService.findMany({
                where: {
                    workspaceId,
                    category: 'procedure',
                    durationMinutes: { not: null },
                    windows: { some: { window: { agentCanBook: true } } },
                },
                orderBy: { name: 'asc' },
                select: { name: true },
            }),
            prisma.specialist.findMany({
                where: {
                    workspaceId,
                    isActive: true,
                    windows: { some: { agentCanBook: true } },
                },
                orderBy: { name: 'asc' },
                select: { name: true },
            }),
        ])

        return {
            contactId: contact.id,
            contactFullName: nome,
            contactFirstName: nome?.split(/\s+/)[0],
            dealTitle: negocio?.title,
            dealStage: negocio?.stage?.name,
            stages: fases.map((f) => f.name),
            bookable: {
                procedimentos: procedimentos.map((p) => p.name),
                especialistas: especialistas.map((e) => e.name),
            },
            upcoming: compromissos
                .filter((a) => a.dueDate)
                .map((a) => ({ quando: quandoCurto(a.dueDate as Date, a.startTime, timezone), titulo: a.title })),
            agora,
        }
    } catch (error) {
        log.warn(`não foi possível montar o contexto da conversa ${conversationId}`, error)
        return { upcoming: [], stages: [], bookable: { procedimentos: [], especialistas: [] }, agora }
    }
}
