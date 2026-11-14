import 'server-only'
import { TENTATIVAS, type JobPayloads, type QueueName } from './definitions'
import { liberar, reservar } from './idempotencia'

/**
 * A disciplina de consumo: confirmar, repetir, desistir.
 *
 * **O que esta camada é, e o que não é.** Ela não sabe o que nenhum processador
 * faz — isso continua em `workers/src/processors/`, que será portado em seguida.
 * O que ela resolve é a parte que erra fácil e cujo erro é caro: quando
 * confirmar a mensagem, quando pedir a retentativa, e como não processar duas
 * vezes o que o broker entregar duas vezes.
 *
 * Separado de propósito, porque as duas coisas mudam por motivos diferentes: um
 * processador muda quando a regra de negócio muda; isto muda quando a gente
 * aprende algo sobre o broker.
 *
 * ## As três regras, e o que acontece se forem violadas
 *
 * 1. **Confirmar (`ack`) é dizer "não me mande de novo".** Confirmar antes de
 *    terminar perde a mensagem se o trabalho falhar depois. Então `ack` só no
 *    fim, e só no caminho de sucesso.
 *
 * 2. **Repetição é o normal, não a falha.** Queues entrega *at-least-once* por
 *    desenho: a mesma mensagem chega duas vezes de vez em quando, e o mesmo lote
 *    pode ir para dois consumidores. A dedup é da `processed_messages` — ver
 *    `lib/queue/idempotencia.ts`.
 *
 * 3. **Falhar tem de liberar a chave.** Sem isso a retentativa seria descartada
 *    como duplicada e a mensagem morreria em silêncio — exatamente o defeito que
 *    o comentário de `enqueue-whatsapp.ts` registra ter acontecido com uma
 *    mensagem real recebida pelo sistema.
 */

/**
 * O lote, tipado **estruturalmente** em vez de importado da Cloudflare.
 *
 * Deliberado: declarar a forma aqui — em vez de `import type { MessageBatch }`
 * — é o que permite esta função ser exercitada por `npm run check:filas`, que
 * roda no tsconfig do app. E é justamente aqui que vale poder testar: a
 * disciplina de `ack`/`retry` e a dedup são o que erra mais, e são o que o
 * `workerd` me impediria de verificar nesta máquina.
 *
 * O Worker passa o lote real; o tipo confere a forma. `MessageBatch` da
 * Cloudflare satisfaz isto estruturalmente.
 */
export interface MensagemDaFila<T> {
    readonly body: T
    /** Quantas vezes esta mensagem já foi entregue. Começa em 1. */
    readonly attempts: number
    ack(): void
    retry(opcoes?: { delaySeconds?: number }): void
}

export interface LoteDaFila<T> {
    readonly messages: readonly MensagemDaFila<T>[]
}

/**
 * O pouco que o processador precisa saber sobre a entrega.
 *
 * Existe por um caso só, e concreto: o `whatsapp-outbound` marca a mensagem
 * como falha no banco **na última tentativa**, para o atendente parar de ver
 * "enviando". Sem saber que é a última, ou marca cedo (mensagem que ainda vai
 * sair aparece como falha) ou nunca (mensagem morta na DLQ fica "enviando"
 * para sempre).
 *
 * É deliberadamente isto e nada mais. Expor o objeto da mensagem deixaria o
 * processador chamar `ack`/`retry` por conta própria, e a disciplina de consumo
 * — a parte que este módulo existe para garantir — deixaria de valer.
 */
export interface ContextoDaEntrega {
    /** Quantas vezes esta mensagem já foi entregue, contando esta. */
    tentativa: number
    /** Falhar agora manda para a DLQ: não há próxima. */
    ultimaTentativa: boolean
}

/** O que um processador precisa fazer: o trabalho, e nada sobre o broker. */
export type Processador<N extends QueueName> = (
    payload: JobPayloads[N],
    contexto: ContextoDaEntrega
) => Promise<void>

/**
 * De onde sai o id de deduplicação de cada fila.
 *
 * `undefined` significa "esta fila não deduplica". Não é descuido: dedup exige
 * um id **estável e externo**, e só algumas filas têm um. Inventar um id a
 * partir do conteúdo (hash do payload) seria pior que não deduplicar — duas
 * mensagens legitimamente idênticas do mesmo paciente ("ok", "ok") teriam o
 * mesmo hash, e a segunda desapareceria.
 */
export type ExtratorDeId<N extends QueueName> = (payload: JobPayloads[N]) => string | undefined

export interface ConsumoDeFila<N extends QueueName> {
    fila: N
    processar: Processador<N>
    idDeDeduplicacao?: ExtratorDeId<N>
    /**
     * O atraso da retentativa, em segundos, pela contagem de tentativas.
     *
     * O `retry_delay` do `wrangler.jsonc` é **fixo** — o Queues não tem backoff
     * exponencial de configuração, ao contrário do BullMQ. Onde o crescimento
     * importa, é aqui que ele é reimplementado: a função recebe quantas vezes a
     * mensagem já foi tentada e devolve o atraso.
     */
    atrasoDaRetentativa?: (tentativa: number) => number
}

export interface ResultadoDoLote {
    confirmados: number
    repetidos: number
    retentados: number
}

/**
 * Processa um lote.
 *
 * Mensagem por mensagem, com `ack`/`retry` individual — e **não**
 * `batch.ackAll()`. O `ackAll` é mais curto e confirmaria o lote inteiro quando
 * uma mensagem no meio falhasse: nove processadas e uma perdida, sem sintoma.
 */
export async function consumirLote<N extends QueueName>(
    lote: LoteDaFila<JobPayloads[N]>,
    consumo: ConsumoDeFila<N>
): Promise<ResultadoDoLote> {
    const r: ResultadoDoLote = { confirmados: 0, repetidos: 0, retentados: 0 }

    for (const mensagem of lote.messages) {
        const idExterno = consumo.idDeDeduplicacao?.(mensagem.body)

        if (idExterno) {
            const primeiraVez = await reservar(consumo.fila, idExterno)

            if (!primeiraVez) {
                /**
                 * Já processada: confirma **sem** reprocessar.
                 *
                 * Confirmar é o certo aqui, não pedir retentativa: a mensagem
                 * não tem nada de errado, e o trabalho dela já foi feito. Pedir
                 * retentativa a mandaria para a DLQ depois de algumas voltas, e
                 * a DLQ encheria de mensagens que estão perfeitamente bem.
                 */
                mensagem.ack()
                r.repetidos++
                continue
            }
        }

        try {
            await consumo.processar(mensagem.body, {
                tentativa: mensagem.attempts,
                ultimaTentativa: mensagem.attempts >= TENTATIVAS[consumo.fila],
            })
            mensagem.ack()
            r.confirmados++
        } catch (erro) {
            // Libera a chave ANTES de pedir a retentativa — regra 3.
            if (idExterno) await liberar(consumo.fila, idExterno)

            const atraso = consumo.atrasoDaRetentativa?.(mensagem.attempts)

            console.error(
                `[FILA ${consumo.fila}] tentativa ${mensagem.attempts} falhou:`,
                erro instanceof Error ? erro.message : erro
            )

            mensagem.retry(atraso !== undefined ? { delaySeconds: atraso } : undefined)
            r.retentados++
        }
    }

    return r
}

/**
 * Backoff exponencial, para as filas em que insistir devagar faz diferença.
 *
 * Reimplementa o que o BullMQ dava por configuração. O teto existe porque sem
 * ele a sétima tentativa do `asaas-event` cairia a horas de distância — e
 * cobrança parada esperando é pior que cobrança tentada de novo em cinco
 * minutos.
 */
export function exponencial(baseSegundos: number, tetoSegundos = 300) {
    return (tentativa: number): number =>
        Math.min(baseSegundos * 2 ** Math.max(0, tentativa - 1), tetoSegundos)
}
