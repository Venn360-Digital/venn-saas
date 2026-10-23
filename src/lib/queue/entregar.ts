import 'server-only'
import type { JobPayloads, QueueName } from './definitions'
import { driverAtual } from './driver'
import { getQueue } from './index'

/**
 * Entrega um trabalho à fila nos dois mundos da transição — **a partir de
 * rotas da aplicação**.
 *
 * Com driver registrado — o Worker da Cloudflare o registra na inicialização,
 * no próprio `fetch` (ver `src/cloudflare/costuras.ts` e `entrada.ts`) — vai
 * pela costura, que fala Cloudflare Queues. Sem driver — o servidor Next na
 * VPS, que não registra nenhum — cai no BullMQ direto, com o `jobId` que o
 * Redis usa para deduplicar.
 *
 * **Por que existe além de `trabalhos/filas.ts`.** O `enfileirar()` de lá é
 * para os processadores, que só rodam onde há driver, e por isso **lança**
 * quando não há. Uma rota do Next roda nos dois lugares, então precisa do
 * caminho de volta ao BullMQ — é o que este módulo acrescenta.
 *
 * Medido em 2026-10-23: quatro rotas ainda chamavam `getQueue().add()` direto
 * — o envio humano de mensagem, a indexação de RAG, o webhook do Asaas e o
 * widget do site. No Worker, sem Redis, cada uma lançava
 * `MissingRedisUrlError`: a atendente digitava e a mensagem **não saía da
 * caixa**, com a linha pareada e o resto no ar.
 */
export interface OpcoesDeEntrega {
    /** Rótulo do job no painel do BullMQ. O Queues não tem nome nem painel. */
    nome: string
    /**
     * Dedup no envio, **só no BullMQ**. O Queues não deduplica ao enviar; lá a
     * garantia mora no consumo (ver `IDS_DE_DEDUP` em `entrada.ts`).
     */
    jobId?: string
    /**
     * Quanto esperar antes de entregar, em segundos inteiros.
     *
     * Em segundos e não milissegundos de propósito: o Queues só aceita inteiro,
     * e o contrato do driver é o mínimo que os dois suportam. A perda de
     * precisão fica visível aqui, no chamador, e não calada no driver.
     */
    atrasoSegundos?: number
}

export async function entregar<N extends QueueName>(
    fila: N,
    payload: JobPayloads[N],
    opcoes: OpcoesDeEntrega
): Promise<void> {
    const driver = driverAtual()
    if (driver) {
        await driver.enviar(
            fila,
            payload,
            opcoes.atrasoSegundos ? { atrasoSegundos: opcoes.atrasoSegundos } : undefined
        )
        return
    }

    // O `add` do BullMQ deriva os tipos de nome e dado da fila por tipos
    // condicionais que não simplificam sob `fila` genérica, então o compilador
    // não prova a correspondência aqui — ainda que cada chamada concreta esteja
    // certa. Caso a handle para a forma que de fato usamos.
    const bull = getQueue(fila) as unknown as {
        add(
            nome: string,
            dado: JobPayloads[N],
            opcoes?: { jobId?: string; delay?: number }
        ): Promise<unknown>
    }

    const extras: { jobId?: string; delay?: number } = {}
    if (opcoes.jobId) extras.jobId = opcoes.jobId
    if (opcoes.atrasoSegundos) extras.delay = opcoes.atrasoSegundos * 1_000

    await bull.add(opcoes.nome, payload, Object.keys(extras).length ? extras : undefined)
}
