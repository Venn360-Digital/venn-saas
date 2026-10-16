import prisma from '@/lib/prisma'
import { isWhatsAppChannel, resolveIntegration, webhookUrlFor } from '@/lib/whatsapp'
import { createLogger } from '../../logger'

const log = createLogger('CRON:HEALTH')

/**
 * Confere o que guardamos contra o provedor — e **tenta trazer de volta** a
 * linha que caiu.
 *
 * O webhook de conexão é o sinal principal, e ele se perde sempre que o app está
 * em deploy ou o provedor reinicia. Isso deixava uma integração marcada como "no
 * ar" com o soquete morto, e o atendente sem entender por que o agente emudeceu.
 *
 * Em 2026-10-15 o caso inverso apareceu, e era pior. O contêiner do provedor
 * reiniciou sob pressão de memória, a linha da clínica caiu **em silêncio** —
 * sem evento `Disconnected`, portanto sem webhook — e ficou três horas fora do
 * ar. Duas falhas se somaram:
 *
 * - A consulta pegava só `connected` e `pending`, então a correção só andava num
 *   sentido. Linha marcada como caída nunca mais era olhada.
 * - E o conserto **não existia**: esta tarefa só relatava. Trazer a linha de
 *   volta era exatamente um `connect`, que reata pelo JID guardado em segundos,
 *   e ninguém o chamava — foi preciso alguém fazer à mão.
 *
 * Agora ela cura. A tarefa roda a cada dez minutos, então esse é o teto do tempo
 * que uma linha fica fora sem ninguém perceber. A tentativa só acontece quando o
 * provedor ainda guarda o JID: sem ele o pareamento acabou de verdade, e um
 * `connect` abriria ciclo de QR em vez de retomar sessão.
 */
export async function runIntegrationHealth(): Promise<void> {
    /**
     * Inclui o que está marcado como **desconectado**, e aqui está o porquê.
     *
     * A consulta pegava só `connected` e `pending`, então a correção só andava
     * num sentido: no ar → fora do ar. O contrário — a linha voltar e nós não
     * sabermos — ficava preso para sempre, porque a única coisa capaz de
     * desfazer era o webhook que justamente se perdeu.
     *
     * Aconteceu em 2026-10-15: o contêiner do provedor reiniciou, a sessão da
     * Ruth **reatou sozinha em cinco segundos**, e o `Connected` foi despachado
     * enquanto o nosso app estava no meio de um deploy. A linha ficou no ar e a
     * tela dizendo "fora do ar" por três horas, até alguém reconectar à mão o
     * que já estava conectado.
     *
     * O recorte é quem **já pareou alguma vez** (`phoneNumber`), para não
     * consultar o provedor sobre linha que nunca foi configurada.
     */
    const integrations = await prisma.agentIntegration.findMany({
        where: {
            OR: [
                { status: { in: ['connected', 'pending'] } },
                { phoneNumber: { not: null } },
            ],
        },
    })

    const whatsapp = integrations.filter((i) => isWhatsAppChannel(i.channel))
    if (whatsapp.length === 0) return

    let drifted = 0
    let curadas = 0

    for (const integration of whatsapp) {
        try {
            const { provider, credentials } = resolveIntegration(integration)
            let state = await provider.getConnectionState(credentials)

            // Caiu, e já esteve pareada: tenta reatar pelo JID antes de aceitar
            // que está fora. É o mesmo `connect` do botão Reconectar, e foi
            // medido voltando em três segundos.
            if (!state.connected && integration.phoneNumber) {
                const jid = provider.getOwnerJid
                    ? await provider.getOwnerJid(credentials).catch(() => undefined)
                    : undefined

                if (jid) {
                    log.info(`integration ${integration.id} caída com JID guardado; reatando`)
                    await provider.connect(credentials, webhookUrlFor(provider.name))
                    await new Promise((resolve) => setTimeout(resolve, 3_000))
                    state = await provider.getConnectionState(credentials)
                    if (state.connected) {
                        curadas += 1
                        log.warn(`integration ${integration.id} reatada pela verificação`)
                    }
                }
            }

            const actual = state.connected ? 'connected' : 'disconnected'
            if (actual === integration.status) continue

            await prisma.agentIntegration.update({
                where: { id: integration.id },
                data: {
                    status: actual,
                    lastActiveAt: new Date(),
                    errorMessage:
                        actual === 'disconnected'
                            ? 'Conexão perdida (detectado na verificação)'
                            : null,
                    // Voltar ao ar carimba a hora: é esta a informação que o
                    // cabeçalho da conversa mostra, e um `connectedAt` velho
                    // faria a linha parecer recém-caída.
                    ...(actual === 'connected' ? { connectedAt: new Date() } : {}),
                },
            })

            drifted += 1
            log.warn(
                `integration ${integration.id} (${provider.name}) drifted: ` +
                `${integration.status} → ${actual}`
            )
        } catch (error) {
            // The provider itself being unreachable, or an integration with no
            // credentials yet, is not evidence that this instance dropped — so the
            // status is left alone.
            log.error(`health check failed for integration ${integration.id}`, error)
        }
    }

    log.info(
        `checked ${whatsapp.length} integration(s), corrected ${drifted}, reattached ${curadas}`
    )
}
