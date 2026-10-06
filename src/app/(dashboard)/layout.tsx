import { AppSidebar } from '@/components/layout/AppSidebar'
import { Topbar } from '@/components/layout/Topbar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

/**
 * The shell owns navigation and nothing else.
 *
 * It used to wrap every page in `container mx-auto p-6` plus a breadcrumb block,
 * which the inbox then had to fight: it set its own full-height calc against a
 * topbar it assumed was 64px tall (it is 56), inside padding it did not want.
 * Page padding and breadcrumbs now belong to PageHeader, so a screen that wants
 * the whole viewport simply does not render one.
 *
 * The rail also has a mobile story for the first time — the old sidebar was an
 * unconditional w-64 div, so below about 900px the content was crushed and there
 * was no way to dismiss it.
 */
export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="min-w-0">
                <Topbar />
                <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
            </SidebarInset>
        </SidebarProvider>
    )
}
