import 'server-only'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'

/**
 * A outbox transacional.
 *
 * **O problema que ela resolve.** O Supabase Realtime lia o WAL do Postgres:
 * gravar a linha *era* publicar o evento, e ninguém precisava pensar nisso. O
 * Neon não publica WAL para a Cloudflare. Então, depois da migração, **escrita
 * no banco não chega sozinha ao Durable Object** — e quem assume o contrário
 * constrói algo que funciona em teste e perde eventos em produção.
 *
 * **Por que não publicar na fila logo depois do commit.** Parece mais simples e
 * é errado nos dois sentidos:
 *
 *   - enfileirar **antes** do commit: se o commit falha, o evento existe e o
 *     dado não — o navegador recebe "tem mensagem nova" para uma mensagem que
 *     não foi gravada;
 *   - enfileirar **depois** do commit: se o processo morre entre as duas coisas,
 *     o dado existe e o evento não — a mensagem está no banco e a tela nunca
 *     atualiza.
 *
 * Não há ordem que resolva, porque são dois sistemas sem transação em comum. A
 * outbox troca o problema por outro que *tem* solução: a gravação do evento vai
 * para dentro da mesma transação do dado, e a publicação passa a ser um trabalho
 * separado, que pode falhar e ser repetido sem perder nada.
 *
 * Dois caminhos publicam, e isso é de propósito:
 *
 *   1. **chamada direta** depois do commit, para latência — é o caminho normal;
 *   2. **varredura periódica** por Cron Trigger, para recuperar o que o primeiro
 *      perdeu. É ela que torna o primeiro dispensável, e por isso o primeiro
 *      pode falhar em silêncio sem consequência.
 */

export type TipoDeEvento =
    /** Mensagem nova numa conversa. */
    | 'mensagem.nova'
    /** A conversa mudou: dono, status, não-lidas, etiqueta. */
    | 'conversa.alterada'
    /** O agente mudou de estado: conectado, pareando, caído. */
    | 'agente.status'
    /** Alguém está digitando. Efêmero: não vale repetir se chegar atrasado. */
    | 'digitando'

export interface EventoParaPublicar {
    workspaceId: string
    tipo: TipoDeEvento
    /**
     * **Identificadores, nunca conteúdo.**
     *
     * O evento diz "a conversa X tem mensagem nova"; o navegador busca o
     * conteúdo pela rota autenticada, onde a autorização já acontece. Assim
     * conteúdo clínico não transita por fila, não aparece em log de fila, e o
     * payload não precisa ser cifrado — o que por sua vez evita ter de decifrar
     * no caminho quente do fan-out.
     */
    payload: Record<string, string | number | boolean | null>
}

/**
 * O recorte do cliente Prisma que esta função precisa.
 *
 * Tipado assim — e não como `PrismaClient` — porque o ponto é **ser chamada
 * dentro de uma transação**: o `tx` que o `$transaction` entrega não é um
 * `PrismaClient`. Aceitar o tipo largo deixaria passar a chamada fora da
 * transação, que é exatamente o defeito que esta tabela existe para impedir.
 */
type ClienteDeTransacao = Pick<Prisma.TransactionClient, 'outboxEvent'>

/**
 * Grava um evento. **Chame de dentro de uma transação.**
 *
 * ```ts
 * await prisma.$transaction(async (tx) => {
 *     const msg = await tx.message.create({ ... })
 *     await gravarEvento(tx, {
 *         workspaceId,
 *         tipo: 'mensagem.nova',
 *         payload: { conversationId: msg.conversationId, messageId: msg.id },
 *     })
 * })
 * ```
 */
export async function gravarEvento(
    tx: ClienteDeTransacao,
    evento: EventoParaPublicar
): Promise<void> {
    await tx.outboxEvent.create({
        data: {
            workspaceId: evento.workspaceId,
            tipo: evento.tipo,
            payload: evento.payload as Prisma.InputJsonObject,
        },
    })
}

/** Um evento lido da outbox, pronto para entregar. */
export interface EventoPendente {
    id: string
    workspaceId: string
    tipo: string
    payload: unknown
    createdAt: Date
    tentativas: number
}

/**
 * Quem entrega o evento adiante.
 *
 * Injetado em vez de importado: é o que permite provar o publicador contra o
 * Neon de verdade **sem** Cloudflare Queues — e o `workerd` não roda na máquina
 * de desenvolvimento (macOS 12.7.6), então sem isto o publicador só seria
 * testável no CI.
 */
export type Entregador = (eventos: EventoPendente[]) => Promise<void>

/**
 * Até onde insistir num evento antes de parar.
 *
 * Seis tentativas: com a varredura de minuto em minuto, é cerca de seis minutos
 * de insistência. Além disso o problema não é transitório, e seguir tentando
 * mantém o índice parcial crescendo e atrasa os eventos bons atrás dele.
 *
 * O evento **não é apagado** ao desistir: ele fica com `ultimoErro` para ser
 * encontrado. Evento de tempo real perdido não precisa ser recuperado — a tela
 * tem o polling de 15 s de rede de segurança e busca o estado real por HTTP —,
 * mas precisa ser **explicável**.
 */
export const MAXIMO_DE_TENTATIVAS = 6

export interface ResultadoDaPublicacao {
    lidos: number
    publicados: number
    desistidos: number
}

/**
 * Publica o que está pendente.
 *
 * `limite` existe porque isto roda num Cron Trigger com teto de CPU: é melhor
 * levar dois ciclos para escoar um acúmulo do que ser morto no meio e não
 * marcar nada como publicado.
 */
export async function publicarPendentes(
    entregar: Entregador,
    { limite = 100 }: { limite?: number } = {}
): Promise<ResultadoDaPublicacao> {
    const pendentes = await prisma.outboxEvent.findMany({
        where: { publishedAt: null, tentativas: { lt: MAXIMO_DE_TENTATIVAS } },
        orderBy: { createdAt: 'asc' },
        take: limite,
        select: {
            id: true,
            workspaceId: true,
            tipo: true,
            payload: true,
            createdAt: true,
            tentativas: true,
        },
    })

    if (pendentes.length === 0) return { lidos: 0, publicados: 0, desistidos: 0 }

    try {
        await entregar(pendentes)
    } catch (erro) {
        /**
         * Falhou o lote inteiro: conta a tentativa e devolve ao fim da fila.
         *
         * Lote inteiro e não evento por evento porque o entregador é em lote —
         * não há como saber qual deles causou a falha sem mais um round-trip por
         * evento, e o custo disso no caminho de recuperação é pior do que
         * reentregar alguns duplicados. O consumidor é idempotente; o navegador
         * descarta repetido pelo último id visto.
         */
        const motivo = erro instanceof Error ? erro.message.slice(0, 500) : 'falha desconhecida'

        await prisma.outboxEvent.updateMany({
            where: { id: { in: pendentes.map((e) => e.id) } },
            data: { tentativas: { increment: 1 }, ultimoErro: motivo },
        })

        const desistidos = pendentes.filter(
            (e) => e.tentativas + 1 >= MAXIMO_DE_TENTATIVAS
        ).length

        return { lidos: pendentes.length, publicados: 0, desistidos }
    }

    /**
     * Marcado como publicado **depois** da entrega.
     *
     * A ordem importa e só há uma segura: marcar antes e falhar a entrega perde
     * o evento para sempre; entregar antes e falhar a marcação reentrega — que o
     * consumidor absorve, porque é idempotente. Entre perder e repetir, repetir.
     */
    const agora = new Date()
    await prisma.outboxEvent.updateMany({
        where: { id: { in: pendentes.map((e) => e.id) } },
        data: { publishedAt: agora },
    })

    return { lidos: pendentes.length, publicados: pendentes.length, desistidos: 0 }
}

/**
 * Apaga o que já foi publicado e envelheceu.
 *
 * A tabela cresce com todo evento entregue, e o histórico não serve para nada
 * depois de algumas horas: o estado real está nas tabelas de domínio. Seis horas
 * é folga suficiente para diagnosticar um incidente do turno.
 *
 * O que **desistiu** (`tentativas >= MAXIMO`) é preservado por mais tempo, pelo
 * `ultimoErro`: é o único registro de que algo não foi entregue.
 */
export async function podarOutbox({
    horas = 6,
    horasDeFalha = 72,
}: { horas?: number; horasDeFalha?: number } = {}): Promise<{ apagados: number }> {
    const limite = new Date(Date.now() - horas * 3600_000)
    const limiteDeFalha = new Date(Date.now() - horasDeFalha * 3600_000)

    const [publicados, falhos] = await Promise.all([
        prisma.outboxEvent.deleteMany({
            where: { publishedAt: { not: null, lt: limite } },
        }),
        prisma.outboxEvent.deleteMany({
            where: { publishedAt: null, tentativas: { gte: MAXIMO_DE_TENTATIVAS }, createdAt: { lt: limiteDeFalha } },
        }),
    ])

    return { apagados: publicados.count + falhos.count }
}
