'use client'

import { Suspense, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Building2, CreditCard, Plug, Plus, User, Users, Zap } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { TabsFrame, type FrameTab } from '@/components/shared/TabsFrame'
import { AutomacoesTab } from '@/components/account/AutomacoesTab'
import { PerfilTab } from '@/components/account/PerfilTab'
import { EmpresaTab } from '@/components/account/EmpresaTab'
import { PlanoTab } from '@/components/account/PlanoTab'
import { UsersPanel, type UsersPanelHandle } from '@/components/management/UsersPanel'
import { IntegrationsPanel } from '@/components/management/IntegrationsPanel'

/**
 * Conta — a Tela 03: uma tela, várias guias.
 *
 * A lista branca é o que decide a aba: um valor fora dela cai em "perfil".
 * "automacoes" tinha gatilho e conteúdo, mas faltava aqui — clicar levava de
 * volta ao perfil, e a aba parecia não abrir.
 */
const TABS: FrameTab[] = [
    { id: 'perfil', label: 'Perfil do usuário', icon: User },
    { id: 'empresa', label: 'Empresa', icon: Building2 },
    { id: 'usuarios', label: 'Usuários', icon: Users },
    { id: 'integracoes', label: 'Integrações', icon: Plug },
    { id: 'automacoes', label: 'Automações', icon: Zap },
    { id: 'plano', label: 'Plano', icon: CreditCard },
]

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
    const activeTab = requested && TABS.some((t) => t.id === requested) ? requested : 'perfil'
    const setActiveTab = (next: string) =>
        router.replace(`${pathname}?tab=${next}`, { scroll: false })

    const [saving, setSaving] = useState(false)
    const users = useRef<UsersPanelHandle>(null)

    const formId = activeTab === 'perfil' ? 'perfil-form' : activeTab === 'empresa' ? 'empresa-form' : null

    /**
     * A ação da guia aberta, sempre no mesmo canto da linha 1 — como o "Novo"
     * das telas de índice. As guias que gravam sozinhas (Automações) ou que
     * agem dentro dos cartões (Integrações, Plano) não têm ação aqui: o lugar
     * fica vazio em vez de ganhar um botão que não faz nada.
     */
    const primary = formId ? (
        <Button type="submit" form={formId} size="sm" className="h-8" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
        </Button>
    ) : activeTab === 'usuarios' ? (
        <Button size="sm" className="h-8 gap-1.5" onClick={() => users.current?.openNew()}>
            <Plus className="size-3.5" /> Novo usuário
        </Button>
    ) : undefined

    return (
        <TabsFrame
            title="Conta"
            tabs={TABS}
            active={activeTab}
            onChange={setActiveTab}
            primary={primary}
        >
            {/* Uma guia por vez, montada só quando abre: os painéis buscam
                dados próprios, e carregá-los sempre tornaria a tela de perfil
                responsável por três requisições que ninguém pediu. */}
            {activeTab === 'perfil' ? <PerfilTab formId="perfil-form" onSavingChange={setSaving} /> : null}
            {activeTab === 'empresa' ? <EmpresaTab formId="empresa-form" onSavingChange={setSaving} /> : null}
            {activeTab === 'usuarios' ? <UsersPanel ref={users} embedded /> : null}
            {activeTab === 'integracoes' ? <IntegrationsPanel embedded /> : null}
            {activeTab === 'automacoes' ? <AutomacoesTab /> : null}
            {activeTab === 'plano' ? <PlanoTab /> : null}
        </TabsFrame>
    )
}

export default function ContaPage() {
    return (
        <Suspense fallback={null}>
            <ContaContent />
        </Suspense>
    )
}
