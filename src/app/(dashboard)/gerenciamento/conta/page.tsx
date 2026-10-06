'use client'

import { Suspense, useState} from 'react'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PerfilTab } from '@/components/account/PerfilTab'
import { EmpresaTab } from '@/components/account/EmpresaTab'
import { PlanoTab } from '@/components/account/PlanoTab'

const TABS = ['perfil', 'empresa', 'plano'] as const

function ContaContent() {
    const searchParams = useSearchParams()

    // Deep-linkable, so the sidebar's "Ver planos" can land on the right tab.
    const requested = searchParams.get('tab')
    const [activeTab, setActiveTab] = useState(
        requested && (TABS as readonly string[]).includes(requested) ? requested : 'perfil'
    )

    return (
        <div className="min-h-screen p-6 text-foreground">
            {/* Header */}
            <div className="mb-6 flex items-center gap-4">
                <Link
                    href="/dashboard"
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-border hover:bg-accent transition-colors"
                >
                    <ArrowLeft className="h-5 w-5" />
                </Link>
                <h1 className="text-2xl font-semibold">Gerenciar conta</h1>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="mb-6 border-b border-border bg-transparent">
                    <TabsTrigger
                        value="perfil"
                        className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none px-4 py-2"
                    >
                        Perfil do usuário
                    </TabsTrigger>
                    <TabsTrigger
                        value="empresa"
                        className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none px-4 py-2"
                    >
                        Empresa
                    </TabsTrigger>
                    <TabsTrigger
                        value="plano"
                        className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none px-4 py-2"
                    >
                        Plano
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="perfil">
                    <PerfilTab />
                </TabsContent>

                <TabsContent value="empresa">
                    <EmpresaTab />
                </TabsContent>

                <TabsContent value="plano">
                    <PlanoTab />
                </TabsContent>
            </Tabs>
        </div>
    )
}

export default function ContaPage() {
    return (
        <Suspense fallback={null}>
            <ContaContent />
        </Suspense>
    )
}
