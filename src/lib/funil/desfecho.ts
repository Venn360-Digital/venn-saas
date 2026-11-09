import 'server-only'
import prisma from '@/lib/prisma'
import { TEXTO_DA_PARADA, type MotivoDeParada } from './passos'

/**
 * Como uma passagem termina.
 *
 * Quatro desfechos, e a diferença entre eles é o que a tela conta sobre o funil:
 *
 * | `status`  | O que aconteceu                                  |
 * |-----------|--------------------------------------------------|
 * | `done`    | andou até o fim do desenho                       |
 * | `stopped` | um **freio** a tirou: alguém atendeu, opt-out…   |
 * | `failed`  | um passo não pôde sair, e os seguintes não saíram |
 * | `running` | está dentro                                       |
 *
 * `stopped` e `done` são separados de propósito. "Parou porque a recepção
 * assumiu a conversa" é o funil funcionando como desenhado; "terminou" é a
 * sequência inteira entregue. Somar os dois num número só esconderia a pergunta
 * que a dona da clínica faz primeiro: o funil está entregando, ou está sendo
 * interrompido?
 */

/**
 * Toda gravação de desfecho passa por aqui, e **só pega quem está `running`**.
 *
 * `updateMany` com `status: 'running'` no `where` é o que torna a gravação
 * idempotente. O Workflows repete um `step.do` cujo resultado não foi
 * confirmado, então `concluir` pode rodar duas vezes — e sem este filtro a
 * segunda sobrescreveria um `stopped` por `done`, trocando "a recepção assumiu"
 * por "entregou tudo" no relatório.
 */
async function encerrar(
    runId: string,
    status: 'done' | 'stopped' | 'failed',
    motivo: string | null
): Promise<{ gravou: boolean }> {
    const r = await prisma.funnelRun.updateMany({
        where: { id: runId, status: 'running' },
        data: { status, stoppedReason: motivo, finishedAt: new Date() },
    })
    return { gravou: r.count > 0 }
}

export function concluir(runId: string): Promise<{ gravou: boolean }> {
    return encerrar(runId, 'done', null)
}

/**
 * Parou por freio. O motivo vai gravado **em português**, não como código.
 *
 * `stoppedReason` é lido na tela por quem atende, e um `humano_assumiu` cru
 * obrigaria a tela a ter um dicionário que divergiria do daqui. O mapa é um só:
 * `TEXTO_DA_PARADA`.
 */
export function parar(runId: string, motivo: MotivoDeParada): Promise<{ gravou: boolean }> {
    return encerrar(runId, 'stopped', TEXTO_DA_PARADA[motivo])
}

export function falhar(runId: string, motivo: string): Promise<{ gravou: boolean }> {
    // 500 caracteres: o motivo pode trazer erro do SES, e coluna de texto livre
    // com mensagem de terceiro inteira já encheu log em outros cantos do projeto.
    return encerrar(runId, 'failed', motivo.slice(0, 500))
}
