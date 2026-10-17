import 'server-only'

import prisma from '@/lib/prisma'
import { getWorkspaceLimits } from '@/lib/limits'
import { assinarConta, perfilDaConta, trocarCodigoPorToken } from '@/lib/instagram/login'
import { MetaOnboardingError } from '@/lib/meta/onboarding'

/**
 * A sequência que transforma o consentimento da clínica numa linha funcionando.
 *
 * Mora aqui, fora da rota, porque quem a executa é o **callback do OAuth** — um
 * `GET` que a Meta provoca ao devolver a pessoa ao navegador. Rota de callback
 * não deve carregar regra de negócio: ela recebe, delega e redireciona.
 *
 * **Quatro passos, e nenhum deles envolve Página do Facebook.** A rota anterior
 * exigia conta profissional, Página vinculada e portfólio empresarial; esta
 * pede só que a conta seja profissional, que é um botão dentro do aplicativo do
 * Instagram. O que mudou não foi a dificuldade do código, foi quem paga por ela.
 *
 * 1. **trocar o código** pelo token de 60 dias — são duas trocas encadeadas, e
 *    parar na primeira guardaria um token que morre em uma hora;
 * 2. **descobrir quem é a conta** — o id da conta profissional, que **não** é
 *    o `user_id` da troca do código, e o @ que a clínica reconhece;
 * 3. **assinar a conta ao aplicativo**, sem o que a Meta aceita tudo e não
 *    manda evento nenhum — foi o que custou a tarde de ontem;
 * 4. **gravar a linha**, com o vencimento junto: é ele que o cron de renovação
 *    lê, e sem ele o token morre aos 60 dias sem ninguém perceber.
 *
 * O limite do plano e a unicidade são conferidos **antes** de assinar: recusar
 * depois deixaria assinatura pendurada do lado de fora, que ninguém limpa.
 */

export type ResultadoDaConexao =
    | { ok: true; integrationId: string; username: string | null }
    | { ok: false; erro: string }

export async function conectarInstagram(input: {
    agentId: string
    workspaceId: string
    code: string
    /** Idêntico ao usado para abrir o diálogo. A Meta confere. */
    redirectUri: string
}): Promise<ResultadoDaConexao> {
    const { agentId, workspaceId, code, redirectUri } = input

    /**
     * O Instagram não ocupa vaga de número do plano.
     *
     * O que o plano vende é "até N números de WhatsApp", e uma conta de
     * Instagram não é um número — contá-la ali faria a clínica perder uma
     * unidade de WhatsApp por ligar o Direct, o que ninguém entenderia na
     * fatura. O teto aqui é outro: uma conta por agente.
     */
    const limits = await getWorkspaceLimits(workspaceId)
    if (limits.unsubscribed) {
        return {
            ok: false,
            erro: 'Este workspace ainda não tem um plano. Escolha um em Gerenciamento → Conta.',
        }
    }

    const jaNesteAgente = await prisma.agentIntegration.findFirst({
        where: { agentId, channel: 'instagram' },
        select: { id: true },
    })
    if (jaNesteAgente) {
        return { ok: false, erro: 'Este agente já tem uma conta de Instagram conectada.' }
    }

    try {
        const token = await trocarCodigoPorToken(code, redirectUri)

        /**
         * O id da conta vem de `/me`, não da troca do código.
         *
         * O `user_id` da troca é escopado ao aplicativo — outro número. É o de
         * `/me?fields=user_id` que aparece no `entry[].id` do webhook, e
         * portanto o único por onde a mensagem que chega encontra o workspace.
         * Guardar o outro deixaria a conexão verde e todo evento órfão.
         *
         * O perfil deixou de ser enfeite por causa disso: sem ele não há o que
         * gravar, e falhar aqui é falhar a conexão.
         */
        const perfil = await perfilDaConta(token.accessToken)
        const igAccountId = perfil.igAccountId ?? token.igAccountId

        if (!igAccountId) {
            return {
                ok: false,
                erro: 'A Meta autorizou mas não disse qual conta é. Tente conectar de novo.',
            }
        }

        /**
         * Uma conta pertence a um workspace por vez.
         *
         * Conferido depois de saber qual é — antes do código trocado não há
         * como saber — e antes de assinar, para não deixar assinatura
         * pendurada numa conexão que vai ser recusada.
         */
        const jaConectada = await prisma.agentIntegration.findFirst({
            where: {
                config: { path: ['instagram', 'igAccountId'], equals: igAccountId },
            },
            select: { id: true },
        })
        if (jaConectada) {
            return { ok: false, erro: 'Esta conta de Instagram já está conectada a um agente.' }
        }

        // Sem isto a Meta responde sucesso em tudo e não manda evento nenhum.
        await assinarConta(token.accessToken)

        const integracao = await prisma.agentIntegration.create({
            data: {
                agentId,
                channel: 'instagram',
                label: perfil?.username ? `@${perfil.username}` : 'Instagram',
                status: 'connected',
                connectedAt: new Date(),
                config: {
                    instagram: {
                        igAccountId,
                        accessToken: token.accessToken,
                        expiresAt: token.expiraEm.toISOString(),
                        username: perfil?.username,
                    },
                },
            },
            select: { id: true },
        })

        return {
            ok: true,
            integrationId: integracao.id,
            username: perfil?.username ?? null,
        }
    } catch (error) {
        if (error instanceof MetaOnboardingError) {
            console.error(`[INSTAGRAM_ONBOARDING] ${error.passo}: ${error.detalhe}`)
            return { ok: false, erro: `Falha ao conectar (${error.passo}): ${error.detalhe}` }
        }

        console.error('[INSTAGRAM_ONBOARDING] falha inesperada', error)
        return { ok: false, erro: 'Não foi possível concluir a conexão. Tente de novo.' }
    }
}
