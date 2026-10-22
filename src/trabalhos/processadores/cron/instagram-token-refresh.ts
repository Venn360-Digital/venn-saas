import { Prisma } from '#prisma'
import prisma from '@/lib/prisma'
import { renovarToken } from '@/lib/instagram/login'
import type { InstagramCredentials } from '@/lib/whatsapp'
import { createLogger } from '@/trabalhos/registro'

const log = createLogger('IG_TOKEN')

/**
 * Renova o token do Instagram antes que ele vença.
 *
 * **É a obrigação que a rota de login do Instagram cria**, e por isso ela é
 * parte do canal e não um extra. Ali o token dura 60 dias; vencido, **não se
 * renova** — a clínica teria de refazer o consentimento inteiro, a Meta não
 * avisa ninguém, e o sintoma seria o erro 190 num envio, dias depois, longe da
 * causa. A rota alternativa dava token sem prazo, mas exigia da clínica Página
 * do Facebook e portfólio empresarial: trocamos um custo do cliente por este,
 * que é nosso.
 *
 * **Com folga larga, de propósito.** Renova a partir de 15 dias do vencimento,
 * e roda de hora em hora. Uma linha só é perdida se ficarmos 15 dias seguidos
 * sem conseguir renovar — o que é tempo de sobra para o alerta ser visto. Mirar
 * o último dia transformaria qualquer indisponibilidade de algumas horas em
 * reconexão manual de todas as clínicas.
 *
 * A Meta exige que o token tenha ao menos 24 horas de vida para ser renovado,
 * e devolve 60 dias contados da renovação.
 */

/** A partir de quando vale a pena renovar. */
const FOLGA_MS = 15 * 24 * 60 * 60 * 1000

export async function runInstagramTokenRefresh(): Promise<void> {
    const linhas = await prisma.agentIntegration.findMany({
        where: { channel: 'instagram' },
        select: { id: true, label: true, config: true, status: true },
    })

    const limite = new Date(Date.now() + FOLGA_MS)
    let renovadas = 0
    let falhas = 0

    for (const linha of linhas) {
        const ig = (linha.config as { instagram?: InstagramCredentials } | null)?.instagram
        if (!ig?.accessToken) continue

        /**
         * Sem data de vencimento não há o que decidir — e inventar uma seria
         * pior que não agir. São as linhas da rota antiga, cujo token não
         * tinha prazo; elas saem daqui quando forem reconectadas.
         */
        if (!ig.expiresAt) continue

        const vence = new Date(ig.expiresAt)
        if (Number.isNaN(vence.getTime()) || vence > limite) continue

        try {
            const novo = await renovarToken(ig.accessToken)

            await prisma.agentIntegration.update({
                where: { id: linha.id },
                data: {
                    config: {
                        ...(linha.config as Prisma.JsonObject),
                        instagram: {
                            ...ig,
                            accessToken: novo.accessToken,
                            expiresAt: novo.expiraEm.toISOString(),
                        },
                    } as Prisma.InputJsonObject,
                    // Uma renovação que dá certo limpa o erro da tentativa
                    // anterior: a linha voltou a estar sadia.
                    status: 'connected',
                    errorMessage: null,
                },
            })

            renovadas += 1
            log.info(`${linha.label ?? linha.id}: token renovado até ${novo.expiraEm.toISOString()}`)
        } catch (error) {
            falhas += 1

            /**
             * A falha fica **na linha**, não só no log.
             *
             * É o que faz a tela poder dizer "reconecte" antes de o paciente
             * ficar sem resposta. Um erro que só existe no log de um worker é
             * um erro que ninguém lê a tempo.
             */
            const detalhe = error instanceof Error ? error.message : String(error)
            await prisma.agentIntegration
                .update({
                    where: { id: linha.id },
                    data: {
                        status: 'error',
                        errorMessage:
                            `Não foi possível renovar o acesso ao Instagram (vence em ` +
                            `${vence.toLocaleDateString('pt-BR')}). Reconecte a conta. ${detalhe}`,
                    },
                })
                .catch(() => null)

            log.error(`${linha.label ?? linha.id}: falha ao renovar`, error)
        }
    }

    if (renovadas || falhas) {
        log.info(`renovação do Instagram: ${renovadas} renovada(s), ${falhas} falha(s)`)
    }
}
