'use client'

import { Suspense, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from '@/components/shared/PageHeader'
import { AutomacoesTab } from '@/components/account/AutomacoesTab'
import { PerfilTab } from '@/components/account/PerfilTab'
import { EmpresaTab } from '@/components/account/EmpresaTab'
import { PlanoTab } from '@/components/account/PlanoTab'
import { UsersPanel } from '@/components/management/UsersPanel'
import { IntegrationsPanel } from '@/components/management/IntegrationsPanel'

const TABS = ['perfil', 'empresa', 'usuarios', 'integracoes', 'plano'] as const

function ContaContent() {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()

    /**
     * The URL is the active tab, not a copy of it.
     *
     * This used to seed `useState` from `?tab=` once. A deep link worked, but
     * only the first time: clicking another `?tab=` link while already on this
     * page is a client-side navigation that does not remount the component, so
     * the state kept whatever tab it had — the three links in the account menu
     * all landed on Perfil. Deriving from the search param also makes switching
     * a tab shareable, because the address bar follows.
     */
    const requested = searchParams.get('tab')
    const activeTab = requested && (TABS as readonly string[]).includes(requested) ? requested : 'perfil'
    const setActiveTab = (next: string) =>
        router.replace(`${pathname}?tab=${next}`, { scroll: false })

    const [saving, setSaving] = useState(false)
    const formId = activeTab === 'perfil' ? 'perfil-form' : activeTab === 'empresa' ? 'empresa-form' : null

    return (
        <>
            <PageHeader
                title="Gerenciar conta"
                description="Perfil, dados da clínica, equipe, integrações e assinatura."
                actions={
                    formId ? (
                        <Button type="submit" form={formId} disabled={saving}>
                            {saving ? 'Salvando…' : 'Salvar'}
                        </Button>
                    ) : undefined
                }
            />
            <div className="px-4 pb-6 md:px-6">
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
                        value="usuarios"
                        className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none px-4 py-2"
                    >
                        Usuários
                    </TabsTrigger>
                    <TabsTrigger
                        value="integracoes"
                        className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none px-4 py-2"
                    >
                        Integrações
                    </TabsTrigger>
                    <TabsTrigger
                        value="automacoes"
                        className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none px-4 py-2"
                    >
                        Automações
                    </TabsTrigger>
                    <TabsTrigger
                        value="plano"
                        className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none px-4 py-2"
                    >
                        Plano
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="perfil">
                    <PerfilTab formId="perfil-form" onSavingChange={setSaving} />
                </TabsContent>

                <TabsContent value="empresa">
                    <EmpresaTab formId="empresa-form" onSavingChange={setSaving} />
                </TabsContent>

                {/* `mount` só quando a guia abre: os dois painéis buscam dados
                    próprios, e carregá-los sempre tornaria a tela de perfil
                    responsável por três requisições que ninguém pediu. */}
                <TabsContent value="usuarios">
                    <UsersPanel embedded />
                </TabsContent>

                <TabsContent value="integracoes">
                    <IntegrationsPanel embedded />
                </TabsContent>

                <TabsContent value="automacoes">
                    <AutomacoesTab />
                </TabsContent>


                <TabsContent value="plano">
                    <PlanoTab />
                </TabsContent>
            </Tabs>
            </div>
        </>
    )
}

export default function ContaPage() {
    return (
        <Suspense fallback={null}>
            <ContaContent />
        </Suspense>
    )
}
