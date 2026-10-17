import 'server-only'

import prisma from '@/lib/prisma'
import { getWorkspaceLimits } from '@/lib/limits'
import {
    PERMISSAO_DE_MENSAGENS,
    assinarContaDeInstagram,
    assinarPaginaAoApp,
    contasDisponiveis,
    escoposDoToken,
    explicarListaVazia,
    faltaPermissaoDeMensagens,
    tokenDeLongaDuracao,
    trocarCodigoPorTokenDeUsuario,
} from '@/lib/instagram/onboarding'
import { MetaOnboardingError } from '@/lib/meta/onboarding'

/**
 * A sequência que transforma o consentimento da clínica numa linha funcionando.
 *
 * Mora aqui, fora da rota, porque quem a executa é o **callback do OAuth** — um
 * `GET` que a Meta provoca ao devolver a pessoa ao navegador. Rota de callback
 * não deve carregar regra de negócio: ela recebe, delega e redireciona.
 *
 * A ordem não é arbitrária:
 *
 * 1. **trocar o código** — vale poucos segundos e serve uma vez, então vem
 *    antes de qualquer ida ao banco;
 * 2. **esticar o token** para longa duração, que é o que faz o token da Página
 *    nascer sem prazo;
 * 3. **achar a Página e a conta**, onde se descobre que a clínica nunca ligou
 *    as duas — a falha mais comum deste fluxo;
 * 4. **conferir que o token pode mesmo atender** — achar a conta não é o
 *    mesmo que poder ler um Direct dela;
 * 5. **assinar a conta ao aplicativo**, sem o que a Meta aceita tudo e não
 *    manda evento nenhum;
 * 6. **gravar a integração**, que é a ponte entre o evento e o workspace.
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
        const tokenCurto = await trocarCodigoPorTokenDeUsuario(code, redirectUri)
        const tokenDeUsuario = await tokenDeLongaDuracao(tokenCurto)
        const contas = await contasDisponiveis(tokenDeUsuario)

        if (contas.length === 0) {
            // Lista vazia tem dois motivos opostos — falta de permissão no
            // aplicativo, ou conta sem Página. Aqui se descobre qual é.
            return { ok: false, erro: await explicarListaVazia(tokenDeUsuario) }
        }

        /**
         * Mais de uma conta: não escolhemos por ela.
         *
         * Quem oferece o seletor de ativos é a própria janela da Meta, e é lá
         * que a escolha pertence. Adivinhar pela primeira da lista ligaria a
         * unidade errada — e isso só apareceria quando um paciente escrevesse
         * para a outra, longe daqui.
         */
        if (contas.length > 1) {
            const nomes = contas
                .map((c) => (c.username ? `@${c.username}` : c.pageName))
                .join(', ')
            return {
                ok: false,
                erro:
                    `Mais de uma conta foi autorizada (${nomes}). Conecte de novo e, na ` +
                    'janela da Meta, deixe selecionada apenas a conta deste agente.',
            }
        }

        const escolhida = contas[0]

        const jaConectada = await prisma.agentIntegration.findFirst({
            where: {
                config: { path: ['instagram', 'igAccountId'], equals: escolhida.igAccountId },
            },
            select: { id: true },
        })
        if (jaConectada) {
            return { ok: false, erro: 'Esta conta de Instagram já está conectada a um agente.' }
        }

        /**
         * Pode mesmo atender, ou só encontrar?
         *
         * Com `instagram_basic` sozinha a busca de contas funciona e a Página
         * aceita ser assinada — tudo parece ter dado certo, e o canal não lê
         * nem envia nada. Aconteceu em 2026-10-17: a linha foi gravada como "no
         * ar" com um token que não podia ler um Direct, e só se descobriu
         * porque nenhuma mensagem chegava. Recusar aqui é muito melhor que
         * descobrir quando um paciente não for respondido.
         */
        const escopos = await escoposDoToken(escolhida.accessToken)
        if (faltaPermissaoDeMensagens(escopos)) {
            return {
                ok: false,
                erro:
                    `A conta foi autorizada, mas sem a permissão ${PERMISSAO_DE_MENSAGENS}, ` +
                    'que é a que permite receber e responder o Direct. Isto é configuração do ' +
                    'aplicativo na Meta: acrescente-a à configuração do Login do Facebook para ' +
                    'Empresas e conecte de novo.',
            }
        }

        /**
         * A conta primeiro, que é quem entrega o Direct.
         *
         * Assinar só a Página não assina a conta — medido: a Página ficava com
         * os quatro campos e `GET /{conta}/subscribed_apps` devolvia vazio,
         * sem um evento sequer chegar.
         */
        await assinarContaDeInstagram(escolhida.igAccountId, escolhida.accessToken)

        /**
         * A Página vai junto, sem poder derrubar a conexão.
         *
         * Ela não é o que entrega o Direct, então falhar aqui não justifica
         * recusar uma conexão que já funciona — fica o log.
         */
        await assinarPaginaAoApp(escolhida.pageId, escolhida.accessToken).catch((erro) =>
            console.warn('[INSTAGRAM_ONBOARDING] a página não foi assinada', erro)
        )

        const integracao = await prisma.agentIntegration.create({
            data: {
                agentId,
                channel: 'instagram',
                label: escolhida.username ? `@${escolhida.username}` : 'Instagram',
                status: 'connected',
                connectedAt: new Date(),
                config: {
                    instagram: {
                        igAccountId: escolhida.igAccountId,
                        pageId: escolhida.pageId,
                        accessToken: escolhida.accessToken,
                        username: escolhida.username,
                    },
                },
            },
            select: { id: true },
        })

        return {
            ok: true,
            integrationId: integracao.id,
            username: escolhida.username ?? null,
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
