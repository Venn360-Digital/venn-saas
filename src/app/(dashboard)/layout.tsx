import { AppSidebar } from '@/components/layout/AppSidebar'
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
 * The skip link is the shell's job too: it has to be the first thing in tab
 * order, which only the layout can guarantee.
 *
 * Page padding belongs to PageHeader, not here — a screen that wants the whole
 * viewport, like the inbox, simply does not render one. The breadcrumb trail
 * belongs to the Topbar, so those screens are still oriented.
 */
export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
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
            <AppSidebar />
            <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
                <Topbar />
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
