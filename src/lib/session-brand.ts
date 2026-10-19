import prisma from '@/lib/prisma'
import { getWorkspaceMember } from '@/lib/auth/workspace'

/**
 * A marca da sessão: em que clínica se está, de qual conta, e a logo da conta.
 *
 * Existe para o **primeiro paint** vir certo. A sidebar desenhava a marca do
 * OdontoBox360 — símbolo e nome em texto — enquanto a resposta da API não
 * chegava, e só então trocava pela logo da clínica. Numa troca de unidade, que é
 * uma recarga inteira, isso é visível e lê como defeito; em toda navegação era
 * um pisca que ninguém tinha reclamado ainda.
 *
 * Não dá para resolver no cliente: ele não tem como saber se existe logo antes
 * de perguntar, e um esqueleto no lugar da marca pioraria o caso da clínica
 * **sem** logo — que é a maioria, e para quem a marca do produto é a resposta
 * final, não um estado intermediário.
 *
 * O mesmo payload serve a rota `/api/account/workspace`, que é o caminho de
 * atualização sem recarregar (gravar a logo na guia Conta da Clínica dispara
 * `workspace:updated`). Uma forma só, lida de um lugar só.
 */
export interface MarcaDaSessao {
    /** A unidade aberta. */
    id: string
    name: string
    /** A logomarca **da conta** — o cabeçalho é um por sessão. */
    logo: string | null
    /** O nome da conta, que é o título do seletor de clínicas. */
    conta: string
    /** As unidades de que esta pessoa participa, da mais antiga à nova. */
    unidades: { id: string; name: string }[]
}

/**
 * Nunca lança.
 *
 * Isto passou a ser lido no layout, logo no caminho de **toda** página do
 * dashboard: uma exceção aqui derruba a tela inteira onde antes, com a busca no
 * cliente, só a logo deixava de aparecer. Degradar para `null` devolve
 * exatamente o comportamento antigo — a marca do produto na calha — em vez de
 * trocar um pisca por um erro 500.
 */
export async function marcaDaSessao(): Promise<MarcaDaSessao | null> {
    try {
        return await lerMarca()
    } catch (error) {
        console.error('[MARCA_DA_SESSAO]', error)
        return null
    }
}

async function lerMarca(): Promise<MarcaDaSessao | null> {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return null

    const [workspace, participacoes] = await Promise.all([
        prisma.workspace.findUnique({
            where: { id: auth.member.workspaceId },
            select: {
                id: true,
                name: true,
                account: { select: { name: true, logo: true } },
            },
        }),
        /**
         * As unidades desta pessoa, na mesma consulta do resto.
         *
         * Juntas porque quem as usa são a marca e o seletor, que estão em toda
         * tela: uma segunda viagem só para saber se existe uma segunda unidade
         * custaria uma ida por carregamento para, em quase todo cliente,
         * responder "não".
         */
        prisma.workspaceUser.findMany({
            /** Suspensa não aparece no seletor: ela está fora do ar. */
            where: {
                userId: auth.member.userId,
                isActive: true,
                workspace: { suspendedAt: null },
            },
            orderBy: { createdAt: 'asc' },
            select: { workspace: { select: { id: true, name: true } } },
        }),
    ])

    if (!workspace) return null

    return {
        id: workspace.id,
        name: workspace.name,
        logo: workspace.account.logo,
        conta: workspace.account.name,
        unidades: participacoes.map((p) => p.workspace),
    }
}
