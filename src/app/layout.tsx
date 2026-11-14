import type { Metadata } from 'next'
import { Open_Sans, Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from '@venn/ui/sonner'
import { TooltipProvider } from '@venn/ui/tooltip'
import { ThemeProvider } from '@/components/theme-provider'
import { BRAND } from '@/config/brand'

// Both are variable fonts, so `weight` is deliberately omitted — naming weights
// would ship four to six files per family instead of one, and the build runs on
// a 2 vCPU box. `variable` is the part that was missing before: the previous
// setup applied only `inter.className`, so globals.css's `--font-sans` and
// `--font-mono` resolved to nothing and every `font-mono` in the app silently
// rendered in the body face.
const openSans = Open_Sans({
    subsets: ['latin'],
    variable: '--font-open-sans',
    display: 'swap',
})

// Loaded for figures only. Its tabular numerals are what keep table columns and
// KPI values aligned; the `num` utility in globals.css reaches for it.
const inter = Inter({
    subsets: ['latin'],
    variable: '--font-inter',
    display: 'swap',
})

export const metadata: Metadata = {
    // `DocumentTitle` renomeia a aba por rota dentro do dashboard; isto é o
    // padrão para login, onboarding e o que for servido do servidor.
    // Vem da marca (`src/config/brand.ts`) — único lugar da identidade.
    title: BRAND.name,
    description: BRAND.tagline,
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="pt-BR" suppressHydrationWarning>
            <body className={`${openSans.variable} ${inter.variable} font-sans`}>
                <ThemeProvider>
                    <TooltipProvider delayDuration={300}>
                        {children}
                        <Toaster />
                    </TooltipProvider>
                </ThemeProvider>
            </body>
        </html>
    )
}
