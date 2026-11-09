/// <reference types="@cloudflare/workers-types" />

import { registrarPublicadorImediato } from '@/lib/outbox/avisar'
import { publicarPendentes } from '@/lib/outbox'
import { entregadorParaSalas } from './publicador'
import { registrarDriver } from '@/lib/queue/driver'
import { criarDriverCloudflare, type BindingsDeFila } from '@/lib/queue/driver-cloudflare'
import { registrarAgenda } from '@/trabalhos/agenda'
import { registrarTransmissor } from '@/trabalhos/tempo-real'
import { registrarTravas } from '@/trabalhos/trava'
import { registrarRemetenteDeEmail } from '@/lib/email/send'
import { registrarMotorDoFunil } from '@/trabalhos/funil'

/**
 * Onde o código da aplicação encontra a plataforma.
 *
 * Cinco costuras, todas registradas em vez de importadas, e sempre pelo mesmo
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
    /**
     * O binding de Email Sending, e o endereço que assina o envio.
     *
     * A forma vem de `registrarRemetenteDeEmail` em vez de ser repetida aqui:
     * uma declaração só, do lado de quem usa o binding, e esta interface não
     * fica livre para divergir dela.
     */
    EMAIL: Parameters<typeof registrarRemetenteDeEmail>[0]
    EMAIL_FROM: string
    /**
     * O motor do funil.
     *
     * `Workflow<{ runId: string }>` e não `Workflow`: o parâmetro é o payload, e
     * declarado assim o typecheck recusa `create` com corpo errado. É a mesma
     * razão de os bindings de fila carregarem o tipo do job.
     */
    FUNIL: Workflow<{ runId: string }>
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

    registrarRemetenteDeEmail(env.EMAIL, env.EMAIL_FROM)

    /**
     * O motor do funil.
     *
     * `id: runId` — o id da instância **é** o id da passagem.
     *
     * Deixar a plataforma gerar o id exigiria guardar o `instanceId` para achar
     * a instância depois, e a tela precisa fazer o caminho inverso (passagem →
     * progresso) em toda listagem. Com os dois iguais, `FUNIL.get(runId)` acha a
     * instância sem consultar o banco.
     *
     * De brinde, isso dá idempotência: criar duas vezes a instância da mesma
     * passagem é recusado pela própria plataforma, por id duplicado, em vez de
     * gerar duas instâncias andando o mesmo funil em paralelo — que é o defeito
     * que mandaria a sequência em dobro.
     */
    registrarMotorDoFunil({
        async criar(runId) {
            const instancia = await env.FUNIL.create({ id: runId, params: { runId } })
            return instancia.id
        },
    })

    // O gateway do Evolution Go NÃO é mais registrado: o canal saiu para o VPS
    // (2026-10-23) e o provider fala HTTP por `EVOLUTION_GO_URL`. Sem registro,
    // `gateway` fica nulo e o `request()` do provider cai sozinho no fetch
    // público — ver src/lib/whatsapp/evolution-go.ts.

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
