/// <reference types="@cloudflare/workers-types" />

import { registrarPublicadorImediato } from '@/lib/outbox/avisar'
import { publicarPendentes } from '@/lib/outbox'
import { entregadorParaSalas } from './publicador'
import { registrarDriver } from '@/lib/queue/driver'
import { criarDriverCloudflare, type BindingsDeFila } from '@/lib/queue/driver-cloudflare'
import { registrarAgenda } from '@/trabalhos/agenda'
import { registrarTransmissor } from '@/trabalhos/tempo-real'
import { registrarTravas } from '@/trabalhos/trava'
import { registrarGatewayEvolutionGo } from '@/lib/whatsapp/evolution-go'

/**
 * Onde o código da aplicação encontra a plataforma.
 *
 * Quatro costuras, todas registradas em vez de importadas, e sempre pelo mesmo
 * motivo: o que elas precisam são *bindings*, que só existem dentro do Worker e
 * chegam por `env`. Importá-los do lado da aplicação exigiria
 * `import { env } from 'cloudflare:workers'` — que não resolve no typecheck
 * desta máquina, porque sem Miniflare local `.cloudflare/types` não é gerado.
 *
 * O efeito colateral bom é que o código portado não sabe em que plataforma
 * está: o mesmo `enfileirar()` funcionava sobre BullMQ e funciona sobre Queues,
 * e é por isso que os processadores atravessaram a migração sem reescrita.
 */
export interface EnvDasCosturas extends BindingsDeFila {
    SALA_DO_WORKSPACE: DurableObjectNamespace
    AGENDA_DA_CONVERSA: DurableObjectNamespace
    TRAVA_DE_CONTATO: DurableObjectNamespace
    /** Service binding para o Worker do canal QR (`odontobox-evolution`). */
    EVOLUTION_GO: Fetcher
}

/**
 * Registra uma vez por isolate.
 *
 * **Guardar o `env` no módulo é seguro aqui e não é em geral.** A documentação
 * da Cloudflare avisa que um isolate pode ser reaproveitado quando só os
 * bindings mudam, então derivar objeto de `env` no escopo do módulo pode
 * guardar valor velho. O que é guardado aqui são *os próprios bindings* — filas
 * e namespaces de Durable Object —, que a plataforma substitui junto com o
 * isolate; não há segredo derivado nem cliente construído a partir de um.
 */
let registrado = false

export function registrarCosturas(env: EnvDasCosturas): void {
    if (registrado) return

    registrarDriver(criarDriverCloudflare(env))

    // O canal QR fala com o contêiner do Evolution Go por este binding.
    registrarGatewayEvolutionGo(env.EVOLUTION_GO)

    registrarAgenda({
        async agendar(conversationId, payload, atrasoMs) {
            // `idFromName(conversationId)`: um objeto por conversa, e é ele que
            // guarda o alarme do debounce.
            const agenda = env.AGENDA_DA_CONVERSA.get(
                env.AGENDA_DA_CONVERSA.idFromName(conversationId)
            )
            const r = await agenda.fetch(
                new Request('http://agenda/agendar', {
                    method: 'POST',
                    body: JSON.stringify({ payload, atrasoMs }),
                })
            )
            if (!r.ok) throw new Error(`/agendar respondeu ${r.status}`)
        },

        async concluir(conversationId) {
            const agenda = env.AGENDA_DA_CONVERSA.get(
                env.AGENDA_DA_CONVERSA.idFromName(conversationId)
            )
            const r = await agenda.fetch(new Request('http://agenda/concluir', { method: 'POST' }))
            if (!r.ok) throw new Error(`/concluir respondeu ${r.status}`)
        },
    })

    registrarTravas({
        async adquirir(chave, token, ttlMs) {
            const trava = env.TRAVA_DE_CONTATO.get(env.TRAVA_DE_CONTATO.idFromName(chave))
            const r = await trava.fetch(
                new Request('http://trava/adquirir', {
                    method: 'POST',
                    body: JSON.stringify({ token, ttlMs }),
                })
            )
            if (!r.ok) throw new Error(`/adquirir respondeu ${r.status}`)
            const { ok } = (await r.json()) as { ok: boolean }
            return ok
        },

        async liberar(chave, token) {
            const trava = env.TRAVA_DE_CONTATO.get(env.TRAVA_DE_CONTATO.idFromName(chave))
            await trava.fetch(
                new Request('http://trava/liberar', {
                    method: 'POST',
                    body: JSON.stringify({ token }),
                })
            )
        },
    })

    registrarTransmissor(async (t) => {
        const sala = env.SALA_DO_WORKSPACE.get(env.SALA_DO_WORKSPACE.idFromName(t.workspaceId))
        const r = await sala.fetch(
            new Request('http://sala/publicar', {
                method: 'POST',
                body: JSON.stringify({
                    // Efêmero: id sorteado, porque não há linha de outbox de onde
                    // tirar um estável — e o descarte de repetido da sala usa
                    // justamente este id.
                    id: crypto.randomUUID(),
                    tipo: t.tipo,
                    payload: t.dados,
                    paraUsuario: t.paraUsuario,
                }),
            })
        )
        if (!r.ok) throw new Error(`/publicar respondeu ${r.status}`)
    })

    /**
     * O caminho imediato da outbox.
     *
     * A varredura de minuto continua existindo, no `scheduled` — mas ela é a
     * rede, não a entrega. Com granularidade de um minuto, uma mensagem de
     * paciente levaria até 60 s para chegar à tela, e o polling de 15 s
     * ganharia do tempo real em todas as vezes.
     */
    registrarPublicadorImediato(async () => {
        await publicarPendentes(entregadorParaSalas(env))
    })

    registrado = true
}
