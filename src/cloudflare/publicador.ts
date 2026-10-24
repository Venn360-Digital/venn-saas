/// <reference types="@cloudflare/workers-types" />

import { publicarPendentes, podarOutbox, type EventoPendente } from '@/lib/outbox'

/**
 * O que fecha o laço do tempo real: outbox → fila → Durable Object → navegador.
 *
 * ## O caminho inteiro, e por que ele tem esse formato
 *
 * ```
 *   rota/consumidor
 *      │ BEGIN
 *      │   INSERT na tabela de domínio  ─┐ mesma
 *      │   INSERT em outbox_events      ─┘ transação
 *      │ COMMIT
 *      ▼
 *   publicarPendentes()  ← aqui
 *      │
 *      ▼
 *   SalaDoWorkspace (um Durable Object por workspace)
 *      │
 *      ▼
 *   fan-out para os WebSockets conectados
 * ```
 *
 * O tempo real anterior lia o WAL e dispensava tudo isto. O Neon não publica WAL
 * para a Cloudflare — ver `lib/outbox/index.ts` para o porquê de não haver
 * atalho.
 *
 * ## Dois gatilhos, de propósito
 *
 * Esta função é chamada pelo **Cron Trigger de cada minuto** e também pode ser
 * chamada direto depois de um commit, para latência. O cron é o que torna a
 * chamada direta dispensável: ela pode falhar em silêncio sem perder evento.
 */

/** O binding do Durable Object da sala. */
interface EnvDoPublicador {
    SALA_DO_WORKSPACE: DurableObjectNamespace
}

/**
 * Entrega os eventos às salas, agrupados por workspace.
 *
 * Agrupar importa: sem isso, dez eventos do mesmo workspace seriam dez
 * `fetch` ao mesmo Durable Object, em série — e o objeto é single-threaded, então
 * cada um esperaria o anterior. Agrupados, é um `fetch` por workspace e o
 * paralelismo fica entre workspaces diferentes, que é onde ele existe de verdade.
 */
export function entregadorParaSalas(env: EnvDoPublicador) {
    return async (eventos: EventoPendente[]): Promise<void> => {
        const porWorkspace = new Map<string, EventoPendente[]>()

        for (const e of eventos) {
            const lista = porWorkspace.get(e.workspaceId)
            if (lista) lista.push(e)
            else porWorkspace.set(e.workspaceId, [e])
        }

        /**
         * `Promise.all` e não um laço sequencial.
         *
         * Workspaces diferentes são objetos diferentes e não disputam nada. E se
         * **um** falhar, o `all` rejeita — o que é o comportamento certo aqui:
         * `publicarPendentes` conta a tentativa do lote inteiro e a varredura do
         * minuto seguinte reentrega. Marcar parte como publicada e parte não
         * exigiria um round-trip por evento, e reentregar alguns duplicados é
         * mais barato — a sala descarta repetido pelo id.
         */
        await Promise.all(
            [...porWorkspace.entries()].map(async ([workspaceId, doWorkspace]) => {
                /**
                 * `idFromName(workspaceId)`: o nome determina o objeto.
                 *
                 * É o que garante que todas as abas de uma clínica caiam na mesma
                 * sala, de qualquer colo, sem nenhum registro de "onde está a
                 * sala do workspace X". E é o que garante que não caiam na sala
                 * de outra clínica.
                 */
                const sala = env.SALA_DO_WORKSPACE.get(
                    env.SALA_DO_WORKSPACE.idFromName(workspaceId)
                )

                for (const e of doWorkspace) {
                    const resposta = await sala.fetch('https://sala/publicar', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ id: e.id, tipo: e.tipo, payload: e.payload }),
                    })

                    if (!resposta.ok) {
                        throw new Error(
                            `sala de ${workspaceId} recusou o evento ${e.id}: HTTP ${resposta.status}`
                        )
                    }
                }
            })
        )
    }
}

/** A varredura do minuto: publica o pendente e poda o que envelheceu. */
export async function varrerOutbox(env: EnvDoPublicador): Promise<void> {
    const resultado = await publicarPendentes(entregadorParaSalas(env))

    if (resultado.desistidos > 0) {
        /**
         * Desistência é registrada em ERRO, não em aviso.
         *
         * Evento de tempo real perdido não precisa ser recuperado — a tela busca
         * o estado real por HTTP e tem o polling de rede de segurança. Mas
         * precisa ser **visto**: desistir significa que a sala esteve
         * inalcançável seis vezes seguidas, e isso não é normal.
         */
        console.error(
            `[OUTBOX] desisti de ${resultado.desistidos} evento(s) depois do máximo de tentativas`
        )
    }

    /**
     * A poda vai junto, no mesmo disparo.
     *
     * Um cron próprio para isto seria um trigger a mais e uma invocação a mais
     * por minuto para apagar quase nada. `deleteMany` com índice é barato, e
     * rodar junto garante que a poda aconteça com a mesma frequência em que a
     * tabela cresce.
     */
    await podarOutbox()
}
