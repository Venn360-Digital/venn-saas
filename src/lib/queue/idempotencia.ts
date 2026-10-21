import 'server-only'
import prisma from '@/lib/prisma'

/**
 * A deduplicação que o `jobId` do BullMQ dava de graça.
 *
 * **A diferença que mais importa entre BullMQ e Cloudflare Queues.** O BullMQ
 * aceita um id de job escolhido por nós e **recusa** um segundo job com o mesmo
 * id. É assim que hoje um webhook reenviado pelo provedor não vira duas
 * mensagens na conversa (ver `enqueue-whatsapp.ts`, que chaveia pelo id da
 * mensagem do provedor).
 *
 * **Cloudflare Queues não tem nada equivalente**, e entrega *at-least-once* por
 * desenho: repetição não é falha, é o contrato. Então a dedup desce para o
 * banco, onde a unicidade é garantida pela chave primária e não pela boa
 * vontade do broker.
 *
 * E isto é mais forte do que o que havia antes, não mais fraco: o `jobId` do
 * BullMQ só deduplicava enquanto o job estivesse retido no Redis — passada a
 * janela de retenção, o mesmo id entrava de novo. Aqui a janela é declarada.
 */

/**
 * Quanto tempo uma chave vale.
 *
 * Vinte e quatro horas. É folga larga sobre a janela de reenvio dos provedores
 * que importam aqui: a Meta reenvia webhook por algumas horas, o Asaas insiste
 * por dias **mas com id de evento estável** — e para o Asaas a defesa de
 * verdade não é esta tabela, é o processamento ser idempotente por id do evento
 * (ver `07-integration-control-plane.md`). Esta janela cobre o caso comum sem
 * deixar a tabela virar histórico.
 */
export const JANELA_PADRAO_HORAS = 24

/**
 * Monta a chave. `<fila>:<id externo>`.
 *
 * A fila entra no prefixo porque o mesmo id externo pode legitimamente ser
 * processado por filas diferentes — a mesma mensagem do WhatsApp gera um job de
 * `whatsapp-inbound` e pode gerar um de `whatsapp-event`. Sem o prefixo, o
 * segundo seria descartado como duplicado do primeiro.
 */
export function chaveDeIdempotencia(fila: string, idExterno: string): string {
    return `${fila}:${idExterno}`
}

/**
 * Reserva a chave. `true` quando é a primeira vez; `false` quando já foi vista.
 *
 * **Reserva, não consulta.** A forma `consultar e depois gravar` tem janela de
 * corrida — e a corrida aqui é o caso **esperado**, não o raro: Queues pode
 * entregar o mesmo lote a dois consumidores ao mesmo tempo, e webhook reenviado
 * chega em paralelo com o original. Então quem decide é o `INSERT`: ele
 * consegue ou colide, atomicamente, e a colisão é a resposta.
 *
 * `createMany` com `skipDuplicates` em vez de `create` dentro de `try/catch`
 * porque a colisão aqui é fluxo normal, não exceção — e porque um `try/catch` em
 * volta de um `create` captura também erro de conexão, respondendo "duplicado"
 * para o que foi apenas falha de rede.
 */
export async function reservar(
    fila: string,
    idExterno: string,
    { janelaHoras = JANELA_PADRAO_HORAS }: { janelaHoras?: number } = {}
): Promise<boolean> {
    const chave = chaveDeIdempotencia(fila, idExterno)
    const expiraEm = new Date(Date.now() + janelaHoras * 3600_000)

    const { count } = await prisma.processedMessage.createMany({
        data: [{ chave, fila, expiraEm }],
        skipDuplicates: true,
    })

    return count === 1
}

/**
 * Libera a chave.
 *
 * Para quando o processamento **falha** e a mensagem vai ser reentregue: sem
 * isto, a retentativa seria descartada como duplicada e a mensagem morreria em
 * silêncio — que é precisamente o defeito que o comentário de
 * `enqueue-whatsapp.ts` registra ter acontecido com uma mensagem real.
 *
 * Chamar no caminho de falha, antes de pedir a retentativa.
 */
export async function liberar(fila: string, idExterno: string): Promise<void> {
    await prisma.processedMessage
        .delete({ where: { chave: chaveDeIdempotencia(fila, idExterno) } })
        .catch(() => undefined)
}

/**
 * Executa uma vez só, mesmo que a mensagem chegue várias.
 *
 * Envolve o par reservar/liberar para que o chamador não possa esquecer o
 * `liberar` no caminho de erro — que é o esquecimento que transforma uma falha
 * transitória em mensagem perdida.
 *
 * Devolve `{ executou: false }` quando era repetição, para que o consumidor
 * possa confirmar a mensagem (`ack`) sem reprocessar.
 */
export async function umaVezSo<T>(
    fila: string,
    idExterno: string,
    trabalho: () => Promise<T>,
    opcoes?: { janelaHoras?: number }
): Promise<{ executou: true; resultado: T } | { executou: false }> {
    if (!(await reservar(fila, idExterno, opcoes))) return { executou: false }

    try {
        return { executou: true, resultado: await trabalho() }
    } catch (erro) {
        await liberar(fila, idExterno)
        throw erro
    }
}

/** Apaga as chaves vencidas. Chamado pela varredura de retenção. */
export async function podarChaves(): Promise<{ apagadas: number }> {
    const { count } = await prisma.processedMessage.deleteMany({
        where: { expiraEm: { lt: new Date() } },
    })
    return { apagadas: count }
}
