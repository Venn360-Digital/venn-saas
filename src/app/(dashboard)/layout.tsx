import { Sidebar } from '@/components/layout/Sidebar'
import { Topbar } from '@/components/layout/Topbar'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="flex h-screen overflow-hidden">
            {/* Sidebar */}
            <Sidebar />

            {/* Main Content */}
            <div className="flex flex-1 flex-col overflow-hidden">
                {/* Topbar */}
                <Topbar />

                {/* Content Area */}
                {/* The page tint now comes from --background, which is no longer
                    the same white as --card. Keeping bg-muted/20 here would
                    double it. */}
                <main className="flex-1 overflow-y-auto">
                    <div className="container mx-auto p-6">
                        {/* Breadcrumbs */}
                        <div className="mb-6">
                            <Breadcrumbs />
                        </div>

                        {/* Page Content */}
                        {children}
                    </div>
                </main>
            </div>
        </div>
    )
}
