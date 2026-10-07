'use client'

import { Suspense, useState} from 'react'
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
        <div className="min-h-full p-6 text-foreground">
            {/* Header */}
            <div className="mb-6 min-w-0">
                <h1 className="text-h1">Gerenciar conta</h1>
                <p className="mt-1 text-sm text-muted-foreground">Perfil, dados da clínica e assinatura.</p>
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
