'use client'

import { Suspense, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CalendarOff, CreditCard, Hospital, Plug, Plus, User, Users, Zap } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { TabsFrame, type FrameTab } from '@/components/shared/TabsFrame'
import { AgendaClinicaTab } from '@/components/management/AgendaClinicaTab'
import { AutomacoesTab } from '@/components/account/AutomacoesTab'
import { PerfilTab } from '@/components/account/PerfilTab'
import { ContaClinicaTab } from '@/components/account/ContaClinicaTab'
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
    /**
     * "Clínica" e "Unidades" viraram uma guia em 2026-10-18, por decisão do
     * Andre: a conta **é** a clínica, e as unidades pertencem a ela. Os campos
     * não mudaram, mudaram de dono — logomarca e CNPJ de cobrança na conta,
     * nome, endereço e telefone em cada unidade.
     *
     * O id continua "empresa": é o que está nos links de ?tab= já salvos, e
     * "unidades" cai aqui pelo apelido logo abaixo.
     */
    { id: 'empresa', label: 'Conta da Clínica', icon: Hospital },
    { id: 'usuarios', label: 'Usuários', icon: Users },
    // Vale para todos os especialistas e sobrepõe as janelas deles — por isso
    // mora na Conta, e não na ficha de um especialista.
    { id: 'agenda', label: 'Agenda da clínica', icon: CalendarOff },
    { id: 'integracoes', label: 'Integrações', icon: Plug },
    { id: 'automacoes', label: 'Automações', icon: Zap },
    { id: 'plano', label: 'Assinatura', icon: CreditCard },
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
    /**
     * Os apelidos de guias que deixaram de existir.
     *
     * "unidades" foi guia por meio dia, e os links dela — o botão da guia Plano,
     * a mensagem de recusa de teto — já estavam escritos. Sem o apelido, cada um
     * cairia no Perfil, que é o pior destino possível: parece que a guia não
     * abriu.
     */
    const APELIDOS: Record<string, string> = { unidades: 'empresa' }
    const pedida = requested ? (APELIDOS[requested] ?? requested) : null
    const activeTab = pedida && TABS.some((t) => t.id === pedida) ? pedida : 'perfil'
    const setActiveTab = (next: string) =>
        router.replace(`${pathname}?tab=${next}`, { scroll: false })

    const users = useRef<UsersPanelHandle>(null)

    /**
     * A linha 1 leva só a ação **da tela** — criar —, como o "Novo" das telas
     * de índice. Gravar é do formulário e fica com ele, no fim da guia: no
     * cabeçalho o Salvar parecia valer para a tela inteira, e numa tela de
     * guias ele vale para uma guia só. Quem grava sozinho (Automações) ou age
     * dentro dos cartões (Integrações, Plano) não põe nada aqui.
     */
    const primary = activeTab === 'usuarios' ? (
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
            // A guia sangrada desenha as próprias faixas e o rodapé preso;
            // o quadro só lhe dá a altura.
            // Todas as guias são sangradas: cada uma desenha as próprias faixas
            // e o rodapé preso, e o quadro só lhes dá a altura.
            fill
        >
            {/* Uma guia por vez, montada só quando abre: os painéis buscam
                dados próprios, e carregá-los sempre tornaria a tela de perfil
                responsável por três requisições que ninguém pediu. */}
            {activeTab === 'perfil' ? <PerfilTab formId="perfil-form" /> : null}
            {activeTab === 'empresa' ? <ContaClinicaTab formId="empresa-form" /> : null}
            {activeTab === 'usuarios' ? <UsersPanel ref={users} /> : null}
            {activeTab === 'agenda' ? <AgendaClinicaTab /> : null}
            {activeTab === 'integracoes' ? <IntegrationsPanel /> : null}
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
