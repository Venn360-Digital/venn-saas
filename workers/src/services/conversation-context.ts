import prisma from '@/lib/prisma'
import { createLogger } from '../logger'

const log = createLogger('CONTEXT')

/** O fuso de quem nunca escolheu — o mesmo que o código usava fixo. */
const TZ_PADRAO = 'America/Sao_Paulo'

export interface ConversationContext {
    /** Como chamar a pessoa. Primeiro nome, que é como se fala no WhatsApp. */
    contactFirstName?: string
    contactFullName?: string
    /** A fase do funil em que o negócio aberto está, se houver. */
    dealStage?: string
    dealTitle?: string
    /** Os próximos compromissos desta pessoa, do mais próximo para o mais distante. */
    upcoming: { quando: string; titulo: string }[]
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

        if (!conversa?.contact) return { upcoming: [], agora }

        const { contact, workspaceId } = conversa

        // O nome de exibição do WhatsApp entra como "WhatsApp 553199..." quando a
        // pessoa não tem nome definido; isso não é nome de gente e não ajuda o
        // modelo a tratar ninguém pelo nome.
        const nome = contact.name && !/^WhatsApp\s/i.test(contact.name) ? contact.name.trim() : undefined

        const [negocio, compromissos] = await Promise.all([
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
        ])

        return {
            contactFullName: nome,
            contactFirstName: nome?.split(/\s+/)[0],
            dealTitle: negocio?.title,
            dealStage: negocio?.stage?.name,
            upcoming: compromissos
                .filter((a) => a.dueDate)
                .map((a) => ({ quando: quandoCurto(a.dueDate as Date, a.startTime, timezone), titulo: a.title })),
            agora,
        }
    } catch (error) {
        log.warn(`não foi possível montar o contexto da conversa ${conversationId}`, error)
        return { upcoming: [], agora }
    }
}
