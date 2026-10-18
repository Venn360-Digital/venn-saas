import { AppSidebar } from '@/components/layout/AppSidebar'
import { marcaDaSessao } from '@/lib/session-brand'
import { DocumentTitle } from '@/components/layout/DocumentTitle'
import { Topbar } from '@/components/layout/Topbar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

/**
 * The shell owns navigation and nothing else.
 *
 * Height is pinned to the viewport on purpose. SidebarInset ships as
 * `flex flex-1 flex-col` with no height of its own, so the shell grew with its
 * content and the document scrolled as a whole — which took the topbar up and
 * out of view with it. Capping the wrapper at the viewport and letting only the
 * content region scroll keeps the topbar and the rail where they belong.
 *
 * The scrolling region is a plain div rather than a <main>: SidebarInset already
 * renders one, and nesting a second was invalid markup that gave assistive
 * technology two competing main landmarks.
 *
 * The sidebar is the `inset` variant (shadcn's sidebar-08): it floats in a
 * gutter painted `bg-sidebar` and the content becomes a rounded card. One
 * consequence worth knowing: the sidebar header and the topbar now sit on
 * different surfaces, so the border alignment we tuned between them no longer
 * applies — there is no shared edge to align.
 *
 * The skip link is the shell's job too: it has to be the first thing in tab
 * order, which only the layout can guarantee.
 *
 * Page padding belongs to PageHeader, not here — a screen that wants the whole
 * viewport, like the inbox, simply does not render one. The breadcrumb trail
 * belongs to the Topbar, so those screens are still oriented.
 */
export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    /**
     * A marca lida **no servidor**, para o primeiro paint já vir certo.
     *
     * A sidebar desenhava o símbolo e o nome do OdontoBox360 enquanto o `fetch`
     * do cliente não voltava, e só então trocava pela logo da clínica. Numa
     * troca de unidade — que é recarga inteira — o pisca é visível e lê como
     * defeito; em toda navegação era um pisca que ninguém havia reclamado.
     *
     * Não havia como resolver no cliente: ele não tem como saber se existe logo
     * antes de perguntar, e um esqueleto no lugar da marca pioraria o caso da
     * clínica **sem** logo, que é a maioria — para ela a marca do produto é a
     * resposta final, não um estado intermediário.
     *
     * O custo é que as telas do dashboard passam a ser renderizadas por
     * requisição em vez de servidas como casca estática. São duas consultas que
     * o cliente já fazia de qualquer forma, agora sem a ida e volta extra.
     */
    const marca = await marcaDaSessao()

    return (
        // `fixed inset-0`, não só `h-svh`: preso ao viewport, o shell não
        // acompanha nenhuma rolagem do documento — nem a elástica do macOS/iOS,
        // nem a que uma página com `h-screen` interno provocava ao estourar a
        // altura. `overscroll-contain` impede que o fim da lista interna
        // "puxe" a página inteira junto.
        <SidebarProvider className="fixed inset-0 h-svh min-h-0 overflow-hidden">
            {/* Primeiro alvo de Tab: sem ele, chegar ao conteúdo por teclado
                custa percorrer a navegação inteira em cada troca de página.
                Invisível até receber foco — então não é enfeite nem ruído. */}
            <a
                href="#conteudo"
                className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-primary-foreground focus-visible:shadow-md"
            >
                Pular para o conteúdo
            </a>
            <DocumentTitle />
            <AppSidebar marca={marca} />
            {/* `overflow-hidden` recorta o Topbar nos cantos do cartão — sem
                ele, a barra pinta por cima do raio do `inset`. */}
            <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
                <Topbar marca={marca} />
                <div
                    id="conteudo"
                    tabIndex={-1}
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-none"
                >
                    {children}
                </div>
            </SidebarInset>
        </SidebarProvider>
    )
}
