import prisma from '@venn/db/cliente'
import { SCHEDULABLE_CATEGORIES } from '../../lib/product-categories'
import { createLogger } from '../registro'

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
/**
 * O que a conta tem cadastrado e o agente pode usar — fases do funil, o que dá
 * para marcar e com quem.
 *
 * Fica separado do contexto da conversa porque **não depende dela**: é cadastro
 * da conta, igual para todo atendimento. Dois motivos para o corte, e o segundo
 * é o que importa:
 *
 * - é a parte **estável** do prompt (ver `buildSystemPrompt`), e ler isso num
 *   lugar só deixa claro o que pode entrar no prefixo cacheável;
 * - o **console de ensaio** precisa exatamente disto e de nada mais: ele não tem
 *   conversa nem contato. Se ele montasse a própria consulta, o prompt do ensaio
 *   divergiria do de produção na primeira mudança aqui — e um ensaio que exercita
 *   outro prompt não prova nada.
 */
async function cadastroDoWorkspace(workspaceId: string): Promise<{
    stages: string[]
    bookable: { procedimentos: string[]; especialistas: string[] }
}> {
    const [fases, procedimentos, especialistas] = await Promise.all([
        prisma.pipelineStage.findMany({
            where: { workspaceId },
            orderBy: { order: 'asc' },
            select: { name: true },
        }),
        /**
         * Só o que o agente pode de fato marcar.
         *
         * Um procedimento sem duração não dá para reservar, e um que nenhuma
         * janela liberada aceita ele não vai conseguir marcar — listar qualquer
         * um dos dois no prompt seria convidá-lo a prometer o que não cumpre.
         */
        prisma.productService.findMany({
            where: {
                workspaceId,
                category: { in: SCHEDULABLE_CATEGORIES },
                durationMinutes: { not: null },
                windows: { some: { window: { agentCanBook: true } } },
            },
            orderBy: { name: 'asc' },
            select: { name: true },
        }),
        prisma.professional.findMany({
            where: { workspaceId, isActive: true, windows: { some: { agentCanBook: true } } },
            orderBy: { name: 'asc' },
            select: { name: true },
        }),
    ])

    return {
        stages: fases.map((f) => f.name),
        bookable: {
            procedimentos: procedimentos.map((p) => p.name),
            especialistas: especialistas.map((e) => e.name),
        },
    }
}

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

        const [negocio, compromissos, cadastro] = await Promise.all([
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
            cadastroDoWorkspace(workspaceId),
        ])

        return {
            contactId: contact.id,
            contactFullName: nome,
            contactFirstName: nome?.split(/\s+/)[0],
            dealTitle: negocio?.title,
            dealStage: negocio?.stage?.name,
            stages: cadastro.stages,
            bookable: cadastro.bookable,
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

/**
 * O contexto de um ensaio: o cadastro da conta, e **ninguém do outro lado**.
 *
 * O instrutor está testando o treinamento, não atendendo uma pessoa. Então o
 * agente recebe as fases e o que pode ser marcado — que é o que o prompt de
 * produção tem — e não recebe contato, negócio nem compromisso, porque não
 * existem.
 *
 * **A ausência de `contactId` é uma garantia, não uma falta.** `generateReply`
 * só monta `toolContext` quando há contato, então o ensaio roda **sem
 * ferramenta**: ele não move negócio de ninguém, não marca consulta e não
 * escreve na agenda. É o que torna seguro deixar o instrutor conversar à
 * vontade com um agente ligado à conta de produção.
 *
 * O preço disso é honesto: o ensaio **não** exercita chamada de ferramenta. Ele
 * prova o que foi escrito nos documentos e o que a busca recupera, que é para
 * isso que ele existe.
 */
export async function carregarContextoDoEnsaio(
    workspaceId: string,
    timezone: string = TZ_PADRAO
): Promise<ConversationContext> {
    const agora = porExtenso(new Date(), timezone)

    try {
        const cadastro = await cadastroDoWorkspace(workspaceId)
        return { upcoming: [], agora, ...cadastro }
    } catch (error) {
        log.warn(`não foi possível montar o contexto do ensaio de ${workspaceId}`, error)
        return { upcoming: [], stages: [], bookable: { procedimentos: [], especialistas: [] }, agora }
    }
}
