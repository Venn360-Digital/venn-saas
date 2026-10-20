'use client'

import { UNIDADE_ADICIONAL, formatPrice, redesDoPlano } from '@/lib/plans'
import { limitsFor, PLAN_PRICES, isPlanId } from '@/lib/plan-limits'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BandLayout, SettingsBand } from '@/components/shared/TabsFrame'
import { RecordDialog, SummaryCard } from '@/components/shared/RecordDialog'
import {
    AlertTriangle,
    ArrowUpDown,
    Building2,
    Lock,
    PauseCircle,
    PlayCircle,
    Check,
    CreditCard,
    Gift,
    Loader2,
    Minus,
    Plus,
    Receipt,
    X
} from 'lucide-react'
import { toast } from 'sonner'
import { BILLING_UPDATED } from '@/components/layout/AppSidebar'
import { CancelarAssinaturaCard } from '@/components/account/CancelarAssinaturaCard'

/**
 * Uma célula de consumo: rótulo, "usado de total", barra fina e a validade.
 *
 * Existe como componente porque são quatro iguais e a tentação, com quatro
 * blocos repetidos no JSX, é deixar um deles divergir — foi assim que o áudio
 * ficou sem medidor por três semanas enquanto o crédito tinha um de 24px.
 *
 * A barra só aparece onde "cheio" significa alguma coisa. Unidade em uso não é
 * consumo: ou cabe ou não cabe, e um medidor de 2 de 3 unidades sugere um
 * gasto que não existe.
 */
function MedidorDeConsumo({
    rotulo,
    usado,
    total,
    nota,
    semBarra = false,
    className,
}: {
    rotulo: string
    usado: number
    total: number
    nota?: string | null
    semBarra?: boolean
    className?: string
}) {
    const pct = total > 0 ? Math.min(100, Math.round((usado / total) * 100)) : 0

    return (
        <div className={cn('px-5 py-4', className)}>
            <p className="text-xs text-muted-foreground">{rotulo}</p>
            <p className="num mt-0.5 text-xl font-semibold">
                {usado.toLocaleString('pt-BR')}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                    de {total.toLocaleString('pt-BR')}
                </span>
            </p>
            {semBarra ? null : (
                <div
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${rotulo}: ${pct}% usado`}
                >
                    <div
                        className={cn(
                            'h-full rounded-full transition-all',
                            pct >= 90 ? 'bg-destructive' : pct >= 80 ? 'bg-warning' : 'bg-primary'
                        )}
                        style={{ width: `${pct}%` }}
                    />
                </div>
            )}
            {nota ? <p className="mt-2 text-xs text-muted-foreground">{nota}</p> : null}
        </div>
    )
}

interface SubscriptionData {
    plan: string
    planName: string
    status: string
    maxAgents: number
    maxMessages: number
    maxWhatsAppNumbers: number
    credits: number
    creditsUsed: number
    maxSpokenReplies: number
    spokenRepliesUsed: number
    paymentMethod: {
        type: string
        last4: string
        brand: string
    } | null
    trialEndsAt: string | null
    currentPeriodEnd: string | null
    /** Até quando a clínica tem para pagar, quando há cobrança vencida. */
    graceEndsAt?: string | null
    /** Cada contratação de unidade viva, para a faixa enfileirá-las. */
    contratosDeUnidade?: {
        id: string
        createdAt: string
        canceledAt: string | null
        endsAt: string | null
        priceCents: number
    }[]
    /** Cada lote de crédito avulso ainda válido. */
    lotesDeCredito?: { id: string; amount: number; used: number; expiresAt: string }[]
    /** Se esta conta é cobrada, e desde quando. */
    regime?: {
        precisaPagar: boolean
        motivo: 'vitalicia' | 'antes_da_data' | null
        a_partir_de: string | null
    }
    pastDueSince?: string | null
    plans: {
        flow: PlanConfig
        pro: PlanConfig
        advanced: PlanConfig
    }
    creditPacks: { credits: number; price: number; discount: number; pitch: string }[]
    /** Os cartões que já pagaram algo desta conta — é entre eles que se troca. */
    cartoes?: {
        id: string
        asaasToken: string
        brand: string | null
        last4: string | null
        isDefault: boolean
    }[]
    /** Franquia e avulso somados — a mesma conta que a sidebar mostra. */
    creditos?: {
        plan: { total: number; used: number; remaining: number }
        purchased: { total: number; used: number; remaining: number; nextExpiry: string | null }
        available: number
        exhausted: boolean
    }
    unidades: {
        used: number
        max: number
        remaining: number
        doPlano: number
        adicionais: number
        /** Contratações já canceladas que ainda valem até a renovação. */
        cancelados: number
        /** O teto depois da renovação, quando as canceladas saírem. */
        maxDepois: number
        /** Quantas clínicas dá para abrir sem criar uma que não caiba depois. */
        livres: number
    }
    /** O que o plano vigente daria, com os adicionais somados. */
    efetivos?: {
        maxWorkspaces: number
        maxAgents: number
        maxWhatsAppNumbers: number
        credits: number
        maxMessages: number
        maxSpokenReplies: number
    }
}

/** Uma unidade da conta, como a tela de unidades a lê. */
interface UnidadeDaConta {
    id: string
    name: string
    createdAt: string
    suspendedAt: string | null
    agentes: number
    canais: number
    conversas: number
    pacientes: number
}

/** Uma cobrança do espelho, como a faixa de histórico a lê. */
interface Cobranca {
    id: string
    kind: string
    status: string
    billingType: string | null
    valueCents: number
    dueDate: string
    paidAt: string | null
    invoiceUrl: string | null
    receiptUrl: string | null
}

interface PlanConfig {
    name: string
    icon: string
    iconDark: string
    description: string
    price: number
    badge: string | null
    features: { text: string; strong?: boolean }[]
    maxAgents: number
    maxMessages: number
    maxWhatsAppNumbers: number
    credits: number
}

export function PlanoTab() {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const [loading, setLoading] = useState(true)
    const [subscription, setSubscription] = useState<SubscriptionData | null>(null)

    // Modal states
    const [showPlanModal, setShowPlanModal] = useState(false)
    const [showCreditsModal, setShowCreditsModal] = useState(false)
    const [showPaymentModal, setShowPaymentModal] = useState(false)
    /** O cancelamento pede o e-mail de quem está logado, digitado à mão. */

    // Action states
    const [selectedPlan, setSelectedPlan] = useState('')
    /**
     * Qual pacote está escolhido, pela quantidade de créditos.
     *
     * Era uma quantidade livre em lotes de mil, e a rota multiplicava por um
     * preço unitário — sem desconto de volume e aceitando qualquer número. Agora
     * a lista é fechada nos três pacotes, e o preço vem de lá.
     */
    /**
     * `null` = nenhum pacote escolhido.
     *
     * Antes vinha com 10.000 pré-selecionado, porque crédito era a única coisa
     * que o diálogo vendia. Com unidade na mesma tela, quem só quer unidade
     * levaria crédito junto sem ter pedido.
     */
    const [pacoteEscolhido, setPacoteEscolhido] = useState<number | null>(null)
    /** Quantas unidades adicionais nesta compra. R$ 290 por mês cada. */
    const [unidadesEscolhidas, setUnidadesEscolhidas] = useState(0)

    /**
     * A janela do checkout, enquanto estiver aberta.
     *
     * Em `useRef` e não em estado: ela não desenha nada, e guardá-la em estado
     * faria a tela repintar a cada mudança de uma coisa que ninguém vê.
     */
    const janelaDoPagamento = useRef<Window | null>(null)
    /** Enquanto o cliente está na janela do Asaas. */
    const [pagando, setPagando] = useState(false)
    /**
     * Qual plano está sendo contratado agora.
     *
     * É o alvo da espera: a tela relê até a assinatura **ser este plano**. A
     * condição anterior era "até ficar ativa", e ela nunca disparava numa troca
     * de plano — a assinatura já estava ativa no plano velho, então a releitura
     * encerrava antes de começar e o rodapé seguia mostrando o plano anterior.
     */
    const [planoEmContratacao, setPlanoEmContratacao] = useState<string | null>(null)
    /**
     * Uma compra de adicionais esperando confirmação do gateway.
     *
     * Separado de `planoEmContratacao` porque o que se espera é outro: ali é o
     * plano virar X; aqui é o saldo ou o teto subir, e o plano não muda.
     */
    const [cobrancas, setCobrancas] = useState<Cobranca[]>([])
    const [cartaoEscolhido, setCartaoEscolhido] = useState<string | null>(null)
    const [showUnidadesModal, setShowUnidadesModal] = useState(false)
    const [showFaturasModal, setShowFaturasModal] = useState(false)
    const [unidadesLista, setUnidadesLista] = useState<UnidadeDaConta[]>([])
    const [mexendoNaUnidade, setMexendoNaUnidade] = useState<string | null>(null)
    const [comprandoAdicionais, setComprandoAdicionais] = useState<{
        adicionais: number
        avulso: number
    } | null>(null)
    const [processing, setProcessing] = useState(false)
    /**
     * O aviso de avaliação, dispensado nesta sessão.
     *
     * O `X` do canto existia e não tinha `onClick`: era um botão morto, que é
     * pior que não ter botão — a pessoa clica, nada acontece, e ela deixa de
     * confiar no resto da tela. Dispensa só a visita atual de propósito: o
     * prazo da avaliação é o que mais importa nesta guia, e esconder para
     * sempre o que está correndo contra o relógio não ajuda ninguém.
     */
    const [avisoDispensado, setAvisoDispensado] = useState(false)

    useEffect(() => {
        loadSubscription()
    }, [])

    /**
     * `useCallback` porque um `useEffect` depende dela.
     *
     * Era função solta, criada de novo a cada render: o intervalo que relê
     * durante a confirmação do pagamento seria desmontado e remontado sem
     * parar, e poderia nunca chegar aos 5 segundos.
     */
    const loadSubscription = useCallback(async () => {
        try {
            const res = await fetch('/api/account/subscription')
            if (res.ok) {
                const data = await res.json()
                setSubscription(data)
                setSelectedPlan(data.plan)
            }
        } catch (error) {
            console.error('Error loading subscription:', error)
            toast.error('Erro ao carregar dados do plano')
        } finally {
            setLoading(false)
        }
    }, [])

    /**
     * O histórico de cobranças, numa chamada à parte.
     *
     * Separado de `loadSubscription` porque as duas têm pressa diferente: a
     * assinatura é sondada de cinco em cinco segundos enquanto um pagamento
     * confirma, e arrastar doze faturas em cada sondagem seria pagar por um
     * dado que não muda nesse intervalo.
     */
    const loadCobrancas = useCallback(async () => {
        try {
            const res = await fetch('/api/account/invoices')
            if (res.ok) {
                const data = await res.json()
                setCobrancas(data.invoices ?? [])
            }
        } catch {
            // Sem histórico a tela continua inteira: ele é consulta, não
            // requisito para contratar nem para pagar.
        }
    }, [])

    useEffect(() => {
        void loadCobrancas()
    }, [loadCobrancas])

    /**
     * As unidades da conta, para a tela de contratações.
     *
     * Carregada só quando o diálogo abre: é uma consulta com contagens de
     * agente, canal, conversa e paciente por unidade, e a guia Plano abre o
     * tempo todo sem precisar dela.
     */
    const loadUnidades = useCallback(async () => {
        try {
            const res = await fetch('/api/account/workspaces')
            if (res.ok) {
                const data = await res.json()
                setUnidadesLista(data.lista ?? [])
            }
        } catch {
            // Sem a lista o diálogo mostra o que já sabe pela assinatura.
        }
    }, [])

    /** Suspende ou reativa uma unidade, e recarrega o que isso muda. */
    const mexerNaUnidade = useCallback(
        async (workspaceId: string, acao: 'suspender' | 'reativar') => {
            setMexendoNaUnidade(workspaceId)
            try {
                const res = await fetch('/api/account/workspaces', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ workspaceId, acao }),
                })
                const data = await res.json()
                if (res.ok) {
                    toast.success(data.message)
                    await Promise.all([loadUnidades(), loadSubscription()])
                    window.dispatchEvent(new Event(BILLING_UPDATED))
                } else {
                    toast.error(data.error || 'Não foi possível concluir')
                }
            } catch {
                toast.error('Não foi possível concluir')
            } finally {
                setMexendoNaUnidade(null)
            }
        },
        [loadUnidades, loadSubscription]
    )

    /**
     * Cancela — ou restaura — uma contratação de unidade adicional.
     *
     * As duas no mesmo lugar porque são a mesma transição em sentidos opostos,
     * e porque o cancelamento só vale na renovação: até lá, desfazer é o
     * conserto natural de um clique errado.
     */
    const mexerNaContratacao = useCallback(async (acao: 'cancel-addon' | 'restore-addon') => {
        setProcessing(true)
        try {
            const res = await fetch('/api/account/subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: acao, units: 1 }),
            })
            const data = await res.json()
            if (res.ok) {
                toast.success(data.message)
                await Promise.all([loadUnidades(), loadSubscription()])
                window.dispatchEvent(new Event(BILLING_UPDATED))
            } else {
                toast.error(data.error || 'Não foi possível concluir')
            }
        } catch {
            toast.error('Não foi possível concluir')
        } finally {
            setProcessing(false)
        }
    }, [loadUnidades, loadSubscription])

    /**
     * Troca o cartão da mensalidade por um que já pagou algo desta conta.
     *
     * Não há campo de número de cartão nesta tela, e isso é desenho: o número
     * nunca passa pela nossa aplicação. Ver o comentário da ação `set-card`.
     */
    const handleSetCard = useCallback(async () => {
        if (!cartaoEscolhido) return
        setProcessing(true)
        try {
            const res = await fetch('/api/account/subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set-card', token: cartaoEscolhido }),
            })
            const data = await res.json()
            if (res.ok) {
                toast.success(data.message)
                setShowPaymentModal(false)
                await loadSubscription()
            } else {
                toast.error(data.error || 'Não foi possível trocar o cartão')
            }
        } catch {
            toast.error('Não foi possível trocar o cartão')
        } finally {
            setProcessing(false)
        }
    }, [cartaoEscolhido, loadSubscription])

    /**
     * Contrata um plano. **O plano vem por parâmetro**, não do estado.
     *
     * Era lido de `selectedPlan`, e o botão do cartão fazia
     * `setSelectedPlan(planKey); handleChangePlan()` — duas linhas no mesmo
     * tick. `setState` não tem efeito até o próximo render, então a função lia
     * o plano **anterior**: clicar em Contratar no Multiclínica mandava o que
     * estava selecionado antes. E como `selectedPlan` nasce igual ao plano
     * atual, o primeiro clique em qualquer cartão mandava o plano atual e caía
     * no "este já é o seu plano" — nada acontecia, e a tela parecia travada.
     */
    const handleChangePlan = async (plano: string) => {
        if (!plano) return
        if (plano === subscription?.plan) {
            toast.error('Este já é o seu plano atual')
            return
        }

        /**
         * A janela abre **aqui**, vazia, ainda dentro do clique.
         *
         * O endereço do checkout só existe depois de uma ida ao servidor, e a
         * essa altura o navegador já não considera a abertura "pedida pelo
         * usuário" — bloqueador de pop-up engole. Abrir vazia agora e dar o
         * endereço depois é o padrão que sobrevive a isso.
         *
         * Conta isenta não paga e não usa janela nenhuma; ela é fechada logo
         * abaixo, no desfecho sem link.
         */
        /**
         * Centrada na tela, e grande o bastante para o formulário do cartão.
         *
         * Sem `left`/`top` o navegador abre no canto superior esquerdo, que foi
         * o que o Andre viu: uma janelinha encolhida num canto parece erro, não
         * pagamento. As coordenadas saem da **janela atual** e não da tela, para
         * acertar quem usa dois monitores — `screenX` é a posição do navegador
         * no conjunto, e abrir centrado na tela 1 enquanto a pessoa trabalha na
         * tela 2 é perder a janela de vista.
         */
        const largura = 560
        const altura = Math.min(880, Math.max(640, window.screen.availHeight - 80))
        const esquerda = Math.round(window.screenX + (window.outerWidth - largura) / 2)
        const topo = Math.round(window.screenY + Math.max(0, (window.outerHeight - altura) / 2))

        janelaDoPagamento.current = window.open(
            '',
            'odontobox-pagamento',
            `width=${largura},height=${altura},left=${esquerda},top=${topo},noopener=no`
        )

        setProcessing(true)
        try {
            const res = await fetch('/api/account/subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'change-plan', plan: plano })
            })

            if (res.ok) {
                const data = await res.json()

                /**
                 * Conta que paga sai desta tela: vai para o checkout do Asaas.
                 *
                 * `window.location.href` e não `router.push`: é outro domínio.
                 * E nada de `_blank` — bloqueador de pop-up engole a aba nova, e
                 * o cliente fica olhando uma tela que não mudou, achando que o
                 * botão não funcionou.
                 */
                if (data.pago && data.link) {
                    /**
                     * A janela já foi aberta no clique, vazia. Aqui ela só
                     * ganha endereço.
                     *
                     * É o único jeito de sobreviver ao bloqueador de pop-up:
                     * `window.open` precisa acontecer **dentro** do gesto do
                     * usuário, e entre o clique e esta linha houve uma ida ao
                     * servidor. Abrir agora seria bloqueado na maioria dos
                     * navegadores.
                     */
                    if (janelaDoPagamento.current && !janelaDoPagamento.current.closed) {
                        janelaDoPagamento.current.location.href = data.link
                        setShowPlanModal(false)
                        setPlanoEmContratacao(plano)
                        setPagando(true)
                        return
                    }

                    // Pop-up bloqueado (ou recusado): o caminho de sempre, a
                    // página inteira. Pior visualmente, mas sempre funciona.
                    toast.success(data.message)
                    window.location.href = data.link
                    return
                }

                // Conta vitalícia ou antes da data de cobrança: ativou direto,
                // e a janela em branco não tem para onde ir.
                janelaDoPagamento.current?.close()
                janelaDoPagamento.current = null

                toast.success(data.message)
                setShowPlanModal(false)
                // Esperado antes de liberar o botão: sem o `await`, o modal
                // fechava e a tela repintava com os números velhos por um
                // instante — o "delay" que parecia bug.
                await loadSubscription()
                // E o rodapé da sidebar, que lê a assinatura por conta própria.
                window.dispatchEvent(new Event(BILLING_UPDATED))
            } else {
                // A janela em branco não pode ficar órfã esperando um endereço
                // que não vem.
                janelaDoPagamento.current?.close()
                janelaDoPagamento.current = null

                const error = await res.json()

                /**
                 * Falta o documento: a recusa leva à tela certa.
                 *
                 * O Asaas exige `cpfCnpj`, e a avaliação não pede documento de
                 * propósito. Um "erro ao alterar plano" aqui mandaria a pessoa
                 * procurar o problema no lugar errado.
                 */
                if (error.faltaDocumento) {
                    toast.error(error.error, {
                        action: {
                            label: 'Preencher',
                            onClick: () => router.replace(`${pathname}?tab=empresa`),
                        },
                    })
                    return
                }

                toast.error(error.error || 'Erro ao alterar plano')
            }
        } catch {
            janelaDoPagamento.current?.close()
            janelaDoPagamento.current = null
            toast.error('Erro ao alterar plano')
        } finally {
            setProcessing(false)
        }
    }

    /**
     * Compra os adicionais escolhidos — crédito, unidades, ou os dois.
     *
     * Desde a fase 3 isto **cobra**: o servidor devolve o link de um checkout
     * avulso (Pix ou cartão) e a entrega acontece quando o pagamento confirma,
     * não quando o botão é clicado. A janela segue o mesmo padrão da troca de
     * plano — aberta vazia dentro do gesto, endereçada depois —, porque o
     * bloqueador de pop-up engole `window.open` que nasce de uma resposta de
     * rede.
     *
     * Conta isenta e cesta abaixo do mínimo do gateway continuam entrando na
     * hora, sem janela: nos dois casos não há nada a cobrar.
     */
    const handleBuyAddons = async () => {
        const largura = 560
        const altura = Math.min(880, Math.max(640, window.screen.availHeight - 80))
        const esquerda = Math.round(window.screenX + (window.outerWidth - largura) / 2)
        const topo = Math.round(window.screenY + Math.max(0, (window.outerHeight - altura) / 2))

        janelaDoPagamento.current = window.open(
            '',
            'odontobox-pagamento',
            `width=${largura},height=${altura},left=${esquerda},top=${topo},noopener=no`
        )

        setProcessing(true)
        try {
            const res = await fetch('/api/account/subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'buy-addons',
                    credits: pacoteEscolhido ?? undefined,
                    units: unidadesEscolhidas,
                }),
            })

            if (res.ok) {
                const data = await res.json()

                if (data.pago && data.link) {
                    if (janelaDoPagamento.current && !janelaDoPagamento.current.closed) {
                        janelaDoPagamento.current.location.href = data.link
                        setShowCreditsModal(false)
                        setPagando(true)
                        /**
                         * A espera é pelos **créditos ou pela unidade**, não
                         * pelo plano: `planoEmContratacao` fica nulo e o
                         * efeito de sondagem para quando a assinatura muda de
                         * saldo ou de teto.
                         */
                        setComprandoAdicionais({
                            adicionais: subscription?.unidades?.adicionais ?? 0,
                            avulso: subscription?.creditos?.purchased.total ?? 0,
                        })
                        return
                    }

                    toast.success(data.message)
                    window.location.href = data.link
                    return
                }

                janelaDoPagamento.current?.close()
                janelaDoPagamento.current = null

                toast.success(data.message)
                setShowCreditsModal(false)
                setPacoteEscolhido(null)
                setUnidadesEscolhidas(0)
                await loadSubscription()
                window.dispatchEvent(new Event(BILLING_UPDATED))
            } else {
                janelaDoPagamento.current?.close()
                janelaDoPagamento.current = null
                const error = await res.json()
                toast.error(error.error || 'Erro ao comprar adicionais')
            }
        } catch {
            janelaDoPagamento.current?.close()
            janelaDoPagamento.current = null
            toast.error('Erro ao comprar adicionais')
        } finally {
            setProcessing(false)
        }
    }

    /**
     * O que o checkout do Asaas devolveu, pela URL de retorno.
     *
     * Lista branca: valor fora dela não desenha faixa nenhuma. É parâmetro de
     * URL, logo texto que qualquer um edita, e uma faixa verde de "pagamento
     * recebido" montada a partir dele seria mentira plantada por quem quisesse.
     * Mesmo os três válidos não ativam nada — só contam o que está acontecendo.
     */
    const pagamentoParam = searchParams.get('pagamento')
    const retornoDoPagamento =
        pagamentoParam === 'processando' || pagamentoParam === 'cancelado' || pagamentoParam === 'expirado'
            ? pagamentoParam
            : null

    /**
     * A janela do pagamento avisando o que aconteceu.
     *
     * Duas fontes, porque a janela pode acabar de duas formas: ela mesma
     * manda a mensagem quando o Asaas a devolve, e o `setInterval` percebe
     * quando a pessoa simplesmente fecha no X — caso em que mensagem nenhuma
     * chega e a tela de trás ficaria esperando para sempre.
     */
    useEffect(() => {
        if (!pagando) return

        const aoReceber = (evento: MessageEvent) => {
            // Só a própria aplicação fala aqui. Sem esta conferência, qualquer
            // página aberta numa aba vizinha poderia dizer "pagamento
            // confirmado" e mudar o que esta tela mostra.
            if (evento.origin !== window.location.origin) return
            const dado = evento.data as { tipo?: string; status?: string } | null
            if (dado?.tipo !== 'odontobox:pagamento') return

            setPagando(false)
            janelaDoPagamento.current = null

            /**
             * O rodapé da sidebar lê a assinatura por conta própria e só relê
             * quando este evento toca.
             *
             * Faltava aqui, e foi o que o Andre viu: a guia Plano mostrava
             * "Digital, alterado com sucesso" enquanto o rodapé continuava
             * dizendo "Prime, 30.000 créditos" — o estado de antes do
             * pagamento, intacto desde o carregamento da página. O caminho
             * antigo, de redirecionamento, avisava; o da janela não.
             */
            window.dispatchEvent(new Event(BILLING_UPDATED))

            if (dado.status === 'processando') {
                // Não ativa nada: quem ativa é o webhook. Isto só põe a tela no
                // estado de espera e começa a reler.
                router.replace(`${pathname}?tab=plano&pagamento=processando`, { scroll: false })
            } else {
                router.replace(`${pathname}?tab=plano&pagamento=${dado.status}`, { scroll: false })
            }
            void loadSubscription()
        }

        window.addEventListener('message', aoReceber)

        const vigia = setInterval(() => {
            if (janelaDoPagamento.current?.closed) {
                clearInterval(vigia)
                setPagando(false)
                janelaDoPagamento.current = null
                // Fechou sem avisar: pode ter pago e fechado rápido. Reler é
                // mais barato que perguntar, e o webhook decide de qualquer forma.
                void loadSubscription()
                window.dispatchEvent(new Event(BILLING_UPDATED))
            }
        }, 1_000)

        return () => {
            window.removeEventListener('message', aoReceber)
            clearInterval(vigia)
        }
    }, [pagando, router, pathname, loadSubscription])

    /**
     * Enquanto o pagamento está em confirmação, a tela relê a cada 5 segundos.
     *
     * Sem isto, quem volta do Pix fica olhando "em avaliação" até recarregar a
     * página à mão — e a conclusão natural é que o pagamento não valeu. Para
     * quando o plano fica ativo, ou depois de dois minutos: passado isso, o que
     * falta não é tempo, é alguém olhar o log.
     */
    useEffect(() => {
        if (retornoDoPagamento !== 'processando') return

        /**
         * Para quando o plano pago **chegou**, e não quando a assinatura está
         * ativa.
         *
         * A condição anterior era `status === 'active'`, e numa troca de plano
         * ela já era verdadeira antes do pagamento: a releitura encerrava antes
         * de começar, e o rodapé ficava com o plano velho até alguém recarregar
         * a página. Sem alvo — contratação vinda de outro lugar — vale a regra
         * antiga, que é melhor que nenhuma.
         */
        /**
         * O que significa "chegou" muda com o que foi comprado.
         *
         * Plano: a assinatura passa a ser aquele plano. Adicional: o plano não
         * muda — o que muda é a contagem de unidades ou o saldo avulso, e é por
         * isso que a sondagem guarda o retrato de antes da compra. Sem esta
         * distinção, comprar crédito deixaria a faixa "aguardando confirmação"
         * girando as 24 tentativas inteiras mesmo depois de o crédito entrar.
         */
        const chegou = planoEmContratacao
            ? subscription?.plan === planoEmContratacao
            : comprandoAdicionais
              ? (subscription?.unidades?.adicionais ?? 0) > comprandoAdicionais.adicionais ||
                (subscription?.creditos?.purchased.total ?? 0) > comprandoAdicionais.avulso
              : subscription?.status === 'active'

        if (chegou) {
            setPlanoEmContratacao(null)
            setComprandoAdicionais(null)
            return
        }

        let tentativas = 0
        const timer = setInterval(() => {
            tentativas += 1
            if (tentativas > 24) {
                clearInterval(timer)
                return
            }
            void loadSubscription()
            window.dispatchEvent(new Event(BILLING_UPDATED))
        }, 5_000)

        return () => clearInterval(timer)
    }, [
        retornoDoPagamento,
        subscription?.status,
        subscription?.plan,
        subscription?.unidades?.adicionais,
        subscription?.creditos?.purchased.total,
        planoEmContratacao,
        comprandoAdicionais,
        loadSubscription,
    ])

    const pacotes = subscription?.creditPacks ?? []
    const pacote = pacoteEscolhido ? pacotes.find((p) => p.credits === pacoteEscolhido) : undefined

    const u = subscription?.unidades

    /** Quanto os adicionais de unidade somam por mês. */
    const mensalDosAdicionais = (u?.adicionais ?? 0) * UNIDADE_ADICIONAL.price

    /** O que a compra em aberto custa, separado por natureza. */
    const aPagarAgora = pacote?.price ?? 0
    const aPagarPorMes = unidadesEscolhidas * UNIDADE_ADICIONAL.price

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <span className="text-muted-foreground">Carregando...</span>
            </div>
        )
    }

    /** Até quando o acesso vale: o fim do ciclo pago ou o fim da avaliação. */
    const isTrialing = subscription?.status === 'trialing'

    /**
     * Se dá para comprar adicional agora — as mesmas duas condições que o
     * servidor cobra em `canBuyAddons`: plano ativo **e** fora da avaliação.
     *
     * Repetidas aqui porque a tela estava oferecendo o que o servidor recusa: o
     * botão ficava clicável durante a avaliação, abria o modal, deixava
     * escolher o adicional e só então devolvia 402. Quem decide continua sendo o
     * servidor; isto é para não convidar para uma porta fechada.
     */
    const podeComprarAdicionais = subscription?.status === 'active'
    const trialDaysLeft = subscription?.trialEndsAt
        ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0

    /** A data em que o próximo lote avulso vence, se houver lote. */
    const venceEm = subscription?.creditos?.purchased.nextExpiry
        ? new Date(subscription.creditos.purchased.nextExpiry).toLocaleDateString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
          })
        : null

    /**
     * O que está guardado contra o que o plano vigente daria.
     *
     * Teto guardado **maior** que o do plano só acontece num caso: a conta
     * desceu de plano e mantém, até a renovação, os recursos que já pagou.
     * Descobrir assim dispensa coluna de "plano agendado" — foi a simplificação
     * que o Andre pediu — e deixa a tela explicar em vez de mostrar "Plano
     * Digital" ao lado de números de Multiclínica sem dizer por quê.
     */
    const ef = subscription?.efetivos
    const aMais = ef
        ? {
            agentes: (subscription?.maxAgents ?? 0) - ef.maxAgents,
            numeros: (subscription?.maxWhatsAppNumbers ?? 0) - ef.maxWhatsAppNumbers,
            creditos: (subscription?.credits ?? 0) - ef.credits,
            audio: (subscription?.maxSpokenReplies ?? 0) - ef.maxSpokenReplies,
        }
        : null
    const trocaPendente = Boolean(
        aMais && (aMais.agentes > 0 || aMais.numeros > 0 || aMais.creditos > 0 || aMais.audio > 0)
    )

    /**
     * O que muda na virada, em palavras.
     *
     * Só o que **cai** entra na frase: com dois adicionais, descer de
     * Multiclínica para Digital não mexe em crédito nem em agentes (30.000 e 3
     * dos dois jeitos) — o que cai são números e áudio. Listar o que não muda
     * assustaria à toa.
     */
    const oQueCai = !aMais
        ? []
        : [
            aMais.agentes > 0 ? `${aMais.agentes} agente(s)` : null,
            aMais.numeros > 0 ? `${aMais.numeros} número(s) de WhatsApp` : null,
            aMais.creditos > 0 ? `${aMais.creditos.toLocaleString('pt-BR')} créditos` : null,
            aMais.audio > 0 ? `${aMais.audio.toLocaleString('pt-BR')} respostas em áudio` : null,
        ].filter(Boolean)

    /** A data da renovação, por extenso curto: "19/11/2026". */
    const renovaEm = subscription?.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).toLocaleDateString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
          })
        : null

    /**
     * As duas carteiras, **separadas** — decisão do Andre em 2026-10-19.
     *
     * Esta tela não soma crédito de plano com crédito avulso. São duas regras
     * diferentes (um renova e zera, o outro vence por lote) e somá-los obriga
     * quem lê a desfazer a conta de cabeça para saber o que tem de gastar
     * primeiro. A sidebar continua somando, porque lá a pergunta é só "ainda
     * dá para responder?".
     */
    const planoTotal = subscription?.creditos?.plan.total ?? subscription?.credits ?? 0
    const planoUsado = subscription?.creditos?.plan.used ?? subscription?.creditsUsed ?? 0
    const avulsoTotal = subscription?.creditos?.purchased.total ?? 0
    const avulsoUsado = subscription?.creditos?.purchased.used ?? 0

    /**
     * O que o plano vigente custa e inclui, **da tabela comercial**.
     *
     * Não da assinatura: a linha do extrato descreve o produto contratado, e os
     * campos gravados carregam o teto pago, que durante um downgrade é o do
     * plano anterior. Dizer "Plano Digital · 30.000 créditos" por causa disso
     * seria descrever o Digital com a franquia do Multiclínica.
     *
     * E `limitsFor` em vez do payload: o tipo `PlanConfig` desta tela declara
     * `maxAgents`/`credits` no primeiro nível, mas `PLANS` os entrega dentro de
     * `limits` — ler de lá traria `undefined` sem erro de compilação.
     */
    const precoDoPlano = isPlanId(subscription?.plan) ? PLAN_PRICES[subscription.plan] : 0
    const incluiDoPlano = limitsFor(subscription?.plan)

    /** A conta que o card nunca mostrou: plano + adicionais. */
    const mensalidadeTotal = precoDoPlano + mensalDosAdicionais

    const temPlano = Boolean(subscription?.plan)

    /**
     * Quando cai a próxima cobrança.
     *
     * Na avaliação é o fim dela — ali a primeira cobrança é o que a pessoa quer
     * saber, e `currentPeriodEnd` ainda não significa nada.
     */
    const cobrancaEm = isTrialing
        ? subscription?.trialEndsAt
            ? new Date(subscription.trialEndsAt).toLocaleDateString('pt-BR', {
                  timeZone: 'America/Sao_Paulo',
              })
            : null
        : renovaEm

    /**
     * O atraso, e até quando ele pode ser resolvido sem parar a clínica.
     *
     * A carência existe desde a fase 4 (3 dias no cartão, 2 no Pix) e só
     * protege quem sabe dela: avisar "em atraso" sem dizer até quando é susto
     * sem instrução.
     */
    /**
     * Quando esta conta **não** será cobrada, e por quê.
     *
     * Vem do servidor (`regime`), e aparece **antes** do clique. Era o defeito
     * que o Andre encontrou: comprar adicional numa conta vitalícia entregava
     * sem cobrar — comportamento correto — e a tela só dizia isso depois, na
     * mensagem de sucesso. Quem testa cobrança lê "comprei sem pagar".
     */
    const regimeSemCobranca =
        subscription?.regime && !subscription.regime.precisaPagar
            ? subscription.regime.motivo === 'vitalicia'
                ? 'Esta conta é vitalícia: nada é cobrado.'
                : `A cobrança desta conta começa em ${
                      subscription.regime.a_partir_de
                          ? new Date(subscription.regime.a_partir_de).toLocaleDateString('pt-BR', {
                                timeZone: 'America/Sao_Paulo',
                            })
                          : 'breve'
                  } — até lá, nada é cobrado.`
            : null

    /** A cobrança que ainda dá para pagar — é por ela que um cartão novo entra. */
    const faturaEmAberto =
        cobrancas.find((c) => c.status === 'OVERDUE' || c.status === 'PENDING')?.invoiceUrl ?? null

    const emAtraso = subscription?.status === 'past_due'
    const carenciaAte = subscription?.graceEndsAt
        ? new Date(subscription.graceEndsAt).toLocaleDateString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
          })
        : null

    /** O cartão, como ele aparece na fatura. */
    const formaDePagamento = subscription?.paymentMethod
        ? [subscription.paymentMethod.brand, subscription.paymentMethod.last4 ? `•••• ${subscription.paymentMethod.last4}` : '']
              .filter(Boolean)
              .join(' ')
        : null

    /** "Plano Evolução" vira "Evolução": o rótulo ao lado já diz "Plano". */
    const planLabel = (subscription?.planName ?? '').replace(/^Plano\s+/i, '')

    /**
     * As unidades em uma frase curta, para caber na célula.
     *
     * O parágrafo longo que explicava plano, adicionais e a virada foi
     * desmontado: o preço virou extrato, a virada virou faixa própria, e aqui
     * fica só de onde vêm as unidades.
     */
    const descricaoCurtaDasUnidades = !u
        ? null
        : u.adicionais > 0
          ? `${u.doPlano} do plano + ${u.adicionais} adicional${u.adicionais === 1 ? '' : 'is'}`
          : 'incluídas no plano'

    return (
        <BandLayout>
            {/* Trial Banner */}
            {isTrialing && !avisoDispensado && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-primary-subtle/40 px-5 py-4 md:px-6">
                    <div className="flex items-center gap-3">
                        <Gift className="h-6 w-6 text-primary" />
                        <div>
                            <p className="font-medium">Sua assinatura está em período de avaliação.</p>
                            <p className="text-sm text-muted-foreground">
                                Você possui {trialDaysLeft} dias de avaliação gratuita e {subscription?.credits?.toLocaleString('pt-BR')} créditos de IA para validar o seu agente de atendimento. Não é necessário inserir o cartão de crédito agora, e nada é cobrado até você efetivar a assinatura
                            </p>
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground"
                        aria-label="Dispensar aviso de avaliação"
                        onClick={() => setAvisoDispensado(true)}
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>
            )}

            {/* Enquanto a janela do Asaas está aberta, a tela de trás diz o
                que está acontecendo — e não finge que nada mudou. */}
            {pagando ? (
                <div
                    className="mb-4 flex items-start gap-3 rounded-lg border border-info/30 bg-info-subtle px-4 py-3 text-info-subtle-foreground"
                    role="status"
                >
                    <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden="true" />
                    <div className="min-w-0 flex-1 text-sm">
                        <p className="font-semibold">Concluindo o pagamento na janela do Asaas.</p>
                        <p className="mt-0.5 text-xs">
                            O cartão é informado na página segura do Asaas — ele não passa pelo
                            OdontoBox360. Assim que você terminar, esta tela se atualiza sozinha.
                        </p>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-current"
                        onClick={() => {
                            janelaDoPagamento.current?.focus()
                        }}
                    >
                        Ver janela
                    </Button>
                </div>
            ) : null}

            {/* A volta do checkout do Asaas.
                
                Três desfechos chegam por `?pagamento=`, e nenhum deles **ativa**
                nada: quem ativa é o webhook. Esta faixa existe porque, sem ela,
                quem acabou de pagar voltaria para uma tela que ainda diz "em
                avaliação" e concluiria que o pagamento falhou — e aí paga de
                novo. É o estado que o sistema nunca teve: "recebemos, estamos
                esperando a confirmação". */}
            {/* O ATRASO, antes de tudo.
                Não é a mesma coisa que o aviso de avaliação: ali a clínica
                ainda não pagou nada e aqui ela já é cliente. A faixa diz o
                prazo e abre o caminho de pagar — a lista de cobranças, logo
                abaixo, tem o link da fatura vencida. */}
            {emAtraso ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-warning-subtle/60 px-5 py-4 md:px-6">
                    <div className="flex items-center gap-3">
                        <AlertTriangle className="size-6 text-warning-subtle-foreground" />
                        <div>
                            <p className="font-medium">Há uma cobrança vencida.</p>
                            <p className="text-sm text-muted-foreground">
                                {carenciaAte
                                    ? `Você tem até ${carenciaAte} para pagar. Depois disso a clínica fica em somente-leitura: as mensagens continuam chegando e o histórico fica inteiro, mas o envio para.`
                                    : 'Regularize para manter o envio de mensagens.'}
                            </p>
                        </div>
                    </div>
                </div>
            ) : null}

            {retornoDoPagamento ? (
                <div
                    className={cn(
                        'mb-4 flex items-start gap-3 rounded-lg border px-4 py-3',
                        retornoDoPagamento === 'processando'
                            ? 'border-info/30 bg-info-subtle text-info-subtle-foreground'
                            : 'border-warning/30 bg-warning-subtle text-warning-subtle-foreground'
                    )}
                    role="status"
                >
                    <div className="min-w-0 flex-1 text-sm">
                        {retornoDoPagamento === 'processando' ? (
                            <>
                                <p className="font-semibold">Pagamento recebido, aguardando confirmação.</p>
                                <p className="mt-0.5 text-xs">
                                    O Pix costuma confirmar em segundos e o cartão em alguns minutos.
                                    Esta tela se atualiza sozinha quando o plano ficar ativo — não é
                                    preciso pagar de novo.
                                </p>
                            </>
                        ) : retornoDoPagamento === 'cancelado' ? (
                            <>
                                <p className="font-semibold">Pagamento cancelado.</p>
                                <p className="mt-0.5 text-xs">
                                    Nada foi cobrado. Você pode contratar de novo quando quiser.
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="font-semibold">O prazo do pagamento expirou.</p>
                                <p className="mt-0.5 text-xs">
                                    Nada foi cobrado. Abra o pagamento de novo em &quot;Alterar plano&quot;.
                                </p>
                            </>
                        )}
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-current"
                        aria-label="Dispensar aviso de pagamento"
                        onClick={() => router.replace(`${pathname}?tab=plano`, { scroll: false })}
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>
            ) : null}

            <SettingsBand title="Minha assinatura">
              <div className="max-w-5xl divide-y divide-border rounded-lg border border-border">
                {/* O QUANTO E O QUANDO, antes de tudo.
                    O card começava pela forma de pagamento e nunca dizia o
                    valor: mostrava R$ 580,00 dos adicionais e calava a
                    mensalidade. Agora a primeira linha é a resposta da primeira
                    pergunta de quem abre uma tela de assinatura. */}
                <div className="grid gap-4 px-5 pb-3 pt-5 sm:grid-cols-[1fr_auto] sm:items-start">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {isTrialing ? 'Primeira cobrança' : 'Próxima cobrança'}
                        </p>
                        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            {temPlano ? (
                                <>
                                    <span className="num text-[2.25rem] font-bold leading-none tracking-tight">
                                        {formatPrice(mensalidadeTotal)}
                                    </span>
                                    <span className="text-sm text-muted-foreground">
                                        {cobrancaEm ? (
                                            <>
                                                em{' '}
                                                <span className="num font-semibold text-foreground">
                                                    {cobrancaEm}
                                                </span>
                                            </>
                                        ) : null}
                                        {formaDePagamento ? ` · ${formaDePagamento}` : null}
                                    </span>
                                </>
                            ) : (
                                <span className="text-h3 font-semibold">Nenhum plano contratado</span>
                            )}
                        </div>
                    </div>
                    {/* A ordem é a do Andre: forma, plano, faturas.
                        Vai do que se mexe com mais frequência para o que só se
                        consulta — e "alterar unidades" saiu daqui para a faixa
                        de adicionais, ao lado de "comprar", que é onde o
                        assunto mora. */}
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                        <Button variant="outline" onClick={() => setShowPaymentModal(true)}>
                            <CreditCard className="size-4" />
                            Forma de pagamento
                        </Button>
                        <Button variant="outline" onClick={() => setShowPlanModal(true)}>
                            <ArrowUpDown className="size-4" />
                            {isTrialing || !temPlano ? 'Contratar plano' : 'Alterar plano'}
                        </Button>
                        <Button variant="outline" onClick={() => setShowFaturasModal(true)}>
                            <Receipt className="size-4" />
                            Ver faturas
                        </Button>
                    </div>
                </div>

                {/* DO QUE O VALOR É FEITO — sem fio no meio.
                    O extrato era faixa separada, e o fio entre o total e as
                    linhas que o explicam sugeria dois assuntos. É um só: o
                    valor e sua composição. Decisão do Andre em 2026-10-19. */}
                {temPlano ? (
                    <div className="px-5 pb-4">
                        <div className="flex items-baseline justify-between gap-4 border-t border-dashed border-border py-2">
                            <p className="text-sm">
                                Plano {planLabel}
                                <span className="text-muted-foreground">
                                    {' · '}
                                    {incluiDoPlano.maxWorkspaces} unidade
                                    {incluiDoPlano.maxWorkspaces === 1 ? '' : 's'},{' '}
                                    {incluiDoPlano.maxAgents} agente
                                    {incluiDoPlano.maxAgents === 1 ? '' : 's'},{' '}
                                    {incluiDoPlano.maxWhatsAppNumbers} número
                                    {incluiDoPlano.maxWhatsAppNumbers === 1 ? '' : 's'},{' '}
                                    {incluiDoPlano.credits.toLocaleString('pt-BR')} créditos
                                </span>
                            </p>
                            <p className="num text-sm font-semibold">{formatPrice(precoDoPlano)}</p>
                        </div>
                        {(u?.adicionais ?? 0) > 0 ? (
                            <div className="flex items-baseline justify-between gap-4 border-t border-dashed border-border py-2">
                                <p className="text-sm">
                                    {u?.adicionais} unidade{u?.adicionais === 1 ? '' : 's'} adicional
                                    {u?.adicionais === 1 ? '' : 'is'}
                                    <span className="text-muted-foreground">
                                        {' · '}1 agente e 1 número cada
                                    </span>
                                </p>
                                <p className="num text-sm font-semibold">
                                    {formatPrice(mensalDosAdicionais)}
                                </p>
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {/* O AVISO DA VIRADA, em faixa própria.
                    Estava no meio de um parágrafo de quatro linhas dentro da
                    descrição do plano — é o fato que mais muda a operação da
                    clínica, e por isso fica colado no valor que ele explica. */}
                {trocaPendente && renovaEm ? (
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 bg-muted px-5 py-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-subtle px-2.5 py-1 text-xs font-semibold text-warning-subtle-foreground">
                            <AlertTriangle className="size-3.5" />
                            Troca em {renovaEm}
                        </span>
                        <p className="text-xs text-muted-foreground">
                            Até lá valem os recursos que você já pagou. Nessa cobrança você passa a
                            ter {oQueCai.join(', ')} a menos.
                        </p>
                    </div>
                ) : null}

                {/* O CONSUMO, uma célula por carteira.
                    As duas de crédito não se somam aqui: cada uma tem a sua
                    regra de validade, e é a validade que decide o que gastar
                    primeiro. A barra fina existe só para o "estou perto do
                    fim?" — o percentual em 24px dizia menos que o número. */}
                <div className="grid sm:grid-cols-2 lg:grid-cols-4">
                    <MedidorDeConsumo
                        rotulo="Crédito do plano"
                        usado={planoUsado}
                        total={planoTotal}
                        nota={
                            renovaEm
                                ? trocaPendente
                                    ? `pago até ${renovaEm}`
                                    : `renova em ${renovaEm}`
                                : null
                        }
                        className="border-b border-border sm:border-r lg:border-b-0"
                    />
                    <MedidorDeConsumo
                        rotulo="Crédito avulso"
                        usado={avulsoUsado}
                        total={avulsoTotal}
                        nota={venceEm ? `expira em ${venceEm}` : 'nenhum lote comprado'}
                        className="border-b border-border lg:border-b-0 lg:border-r"
                    />
                    <MedidorDeConsumo
                        rotulo="Respostas em áudio"
                        usado={subscription?.spokenRepliesUsed ?? 0}
                        total={subscription?.maxSpokenReplies ?? 0}
                        nota={renovaEm ? `renova em ${renovaEm}` : null}
                        className="border-b border-border sm:border-r sm:border-b-0"
                    />
                    <MedidorDeConsumo
                        rotulo="Unidades em uso"
                        usado={u?.used ?? 0}
                        total={u?.max ?? 0}
                        nota={descricaoCurtaDasUnidades}
                        semBarra
                    />
                </div>

              </div>
            </SettingsBand>

            {/* MEUS ADICIONAIS, em faixa própria.
                Era a última linha do card de assinatura, e lá ela competia com
                o que o card existe para dizer — quanto custa e quanto se
                gastou. Adicional é outro assunto: é o que foi contratado à
                parte, cada um com a sua regra de validade. Separado a pedido do
                Andre em 2026-10-19. */}
            <SettingsBand title="Meus adicionais">
                <div className="max-w-5xl divide-y divide-border rounded-lg border border-border">
                    {(subscription?.contratosDeUnidade?.length ?? 0) === 0 &&
                    (subscription?.lotesDeCredito?.length ?? 0) === 0 ? (
                        <p className="px-5 py-4 text-sm text-muted-foreground">
                            Nenhum adicional contratado. O plano sozinho já dá conta — e, se
                            faltar, dá para comprar crédito ou mais uma unidade sem trocar de
                            plano.
                        </p>
                    ) : null}

                    {/* UM CONTRATO POR LINHA, e o mesmo texto em todos.
                        Cada linha tinha uma frase própria, e frases diferentes
                        para a mesma coisa confundem — foi o que o Andre
                        apontou. Agora o título diz o que é e o subtítulo é
                        padrão; o que varia entre linhas é só a data e o estado,
                        que é o que de fato varia. */}
                    {subscription?.contratosDeUnidade?.map((c) => {
                        const cancelada = Boolean(c.canceledAt)
                        const ate = c.endsAt
                            ? new Date(c.endsAt).toLocaleDateString('pt-BR', {
                                  timeZone: 'America/Sao_Paulo',
                              })
                            : null

                        return (
                            <div
                                key={c.id}
                                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-4"
                            >
                                <div>
                                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                        Contratação de unidade
                                        {cancelada ? (
                                            <span className="rounded-full bg-destructive-subtle px-2 py-0.5 text-[11px] font-semibold text-destructive-subtle-foreground">
                                                cancelada{ate ? ` · vale até ${ate}` : ''}
                                            </span>
                                        ) : null}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        1 unidade = 1 novo agente de IA + 1 novo número de WhatsApp
                                    </p>
                                </div>
                                <p
                                    className={cn(
                                        'num text-sm font-semibold',
                                        cancelada && 'text-muted-foreground line-through'
                                    )}
                                >
                                    {formatPrice(c.priceCents / 100)}
                                    <span className="font-normal text-muted-foreground">/mês</span>
                                </p>
                            </div>
                        )
                    })}

                    {/* E cada compra de crédito na sua linha, porque cada uma
                        tem a sua validade: uma frase só teria de escolher uma
                        data e esconder as outras. */}
                    {subscription?.lotesDeCredito?.map((l) => (
                        <div
                            key={l.id}
                            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-4"
                        >
                            <div>
                                <p className="text-sm font-medium">
                                    Contratação de créditos avulsos
                                </p>
                                <p className="num text-xs text-muted-foreground">
                                    Créditos válidos até{' '}
                                    {new Date(l.expiresAt).toLocaleDateString('pt-BR', {
                                        timeZone: 'America/Sao_Paulo',
                                    })}
                                </p>
                            </div>
                            <p className="num text-sm font-semibold">
                                {Math.max(0, l.amount - l.used).toLocaleString('pt-BR')}
                                <span className="font-normal text-muted-foreground">
                                    {' '}
                                    de {l.amount.toLocaleString('pt-BR')}
                                </span>
                            </p>
                        </div>
                    ))}

                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                        <p className="text-xs text-muted-foreground">
                            {podeComprarAdicionais
                                ? regimeSemCobranca ?? '\u00A0'
                                : 'Exige plano ativo. Na avaliação, a franquia é a do plano que você escolher.'}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    void loadUnidades()
                                    setShowUnidadesModal(true)
                                }}
                            >
                                <Building2 className="size-4" />
                                Alterar adicionais
                            </Button>
                            <Button
                                variant="outline"
                                disabled={!podeComprarAdicionais}
                                onClick={() => {
                                    setPacoteEscolhido(null)
                                    setUnidadesEscolhidas(0)
                                    setShowCreditsModal(true)
                                }}
                            >
                                <Plus className="size-4" />
                                Comprar adicionais
                            </Button>
                        </div>
                    </div>
                </div>
            </SettingsBand>

            {/* E no fim da guia, o que não tem volta.
                Voltou para cá a pedido do Andre: ele tentou no rodapé de
                Alterar unidades (confundia) e na Conta da Clínica, e o lugar
                que ficou é este — o fim da guia onde se vê o que se paga.
                Cartão próprio, com borda vermelha, longe da pilha de "alterar"
                e "comprar": a diferença entre trocar o cartão e encerrar a
                conta não pode depender de reparar numa cor de texto. */}
            <CancelarAssinaturaCard />

            {/* AS FATURAS, em tela própria.
                Eram uma faixa abaixo da assinatura, e consulta não disputa
                espaço com decisão: quem abre a guia quer saber quanto paga e
                quanto gastou. A segunda via é a pergunta seguinte, de quem
                precisa dela — e agora tem um botão com esse nome no topo.

                Diálogo e não rota: a guia da Conta não rola (ver DESIGN.md,
                Tela 03), e uma rota nova por lista de leitura seria uma tela a
                mais para manter pelo mesmo resultado. */}
            <RecordDialog
                open={showFaturasModal}
                onOpenChange={setShowFaturasModal}
                title="Faturas"
                description="As últimas cobranças desta conta, com link para a segunda via."
                hideAgain
                submitLabel="Fechar"
                onSubmit={() => setShowFaturasModal(false)}
            >
                <div className="col-span-2">
                    {cobrancas.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            Nenhuma cobrança ainda. A primeira aparece aqui assim que o plano for
                            contratado.
                        </p>
                    ) : (
<div className="max-w-5xl divide-y divide-border rounded-lg border border-border">
                        {cobrancas.map((c) => {
                            const pago = c.status === 'RECEIVED' || c.status === 'CONFIRMED'
                            const vencida = c.status === 'OVERDUE'
                            const quando = new Date(c.paidAt ?? c.dueDate).toLocaleDateString('pt-BR', {
                                timeZone: 'America/Sao_Paulo',
                            })
                            /** O link certo depende do estado: comprovante
                                quando pago, fatura quando há o que pagar. */
                            const destino = pago ? (c.receiptUrl ?? c.invoiceUrl) : c.invoiceUrl

                            return (
                                <div
                                    key={c.id}
                                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3"
                                >
                                    <div className="flex items-center gap-3">
                                        <span
                                            className={cn(
                                                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                                                pago
                                                    ? 'bg-success-subtle text-success-subtle-foreground'
                                                    : vencida
                                                      ? 'bg-destructive-subtle text-destructive-subtle-foreground'
                                                      : 'bg-muted text-muted-foreground'
                                            )}
                                        >
                                            {pago ? 'Pago' : vencida ? 'Vencida' : 'Em aberto'}
                                        </span>
                                        <div>
                                            <p className="text-sm">
                                                {c.kind === 'subscription' ? 'Mensalidade' : 'Compra avulsa'}
                                                {c.billingType ? (
                                                    <span className="text-muted-foreground">
                                                        {' · '}
                                                        {c.billingType === 'PIX' ? 'Pix' : 'Cartão'}
                                                    </span>
                                                ) : null}
                                            </p>
                                            <p className="num text-xs text-muted-foreground">
                                                {pago ? `pago em ${quando}` : `vence em ${quando}`}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="num text-sm font-semibold">
                                            {formatPrice(c.valueCents / 100)}
                                        </span>
                                        {destino ? (
                                            <a
                                                href={destino}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-primary-subtle-foreground underline underline-offset-2"
                                            >
                                                {pago ? 'Comprovante' : 'Pagar'}
                                            </a>
                                        ) : null}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                    )}
                </div>
            </RecordDialog>

            {/* ALTERAR UNIDADES.
                Cenário 1 do comp de 2026-10-19, escolhido pelo Andre.

                A lista é das **unidades contratadas**, não das cadastradas: é o
                que torna visível a contratada sem clínica dentro — o caso que a
                homologação dele expôs, com 3 contratadas e 2 cadastradas.

                A ordem das ações é a do endurecimento: cancelar a contratação
                de uma unidade no ar é recusado, e a frase diz o que destrava
                em vez de o botão ficar cinza sem explicação. */}
            <RecordDialog
                open={showUnidadesModal}
                onOpenChange={setShowUnidadesModal}
                title="Alterar adicionais"
                hideAgain
                submitLabel="Fechar"
                onSubmit={() => setShowUnidadesModal(false)}
            >
                <div className="col-span-2 space-y-4">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="num text-2xl font-bold leading-none">{u?.max ?? 0}</span>
                        <span className="text-sm text-muted-foreground">
                            contratações ·{' '}
                            <strong className="text-foreground">{u?.used ?? 0} cadastradas</strong>
                            {/* Disponível é o que dá para usar; cancelada é o
                                que vai sumir. Somar as duas num número só
                                ("2 disponíveis") contradizia as linhas logo
                                abaixo, que mostram uma de cada. */}
                            {(u?.livres ?? 0) > 0
                                ? ` · ${u?.livres} disponível${u?.livres === 1 ? '' : 'is'}`
                                : null}
                            {(u?.cancelados ?? 0) > 0
                                ? ` · ${u?.cancelados} cancelada${u?.cancelados === 1 ? '' : 's'}`
                                : null}
                        </span>
                        {mensalDosAdicionais > 0 ? (
                            <span className="rounded-full bg-info-subtle px-2.5 py-1 text-xs font-semibold text-info-subtle-foreground">
                                {formatPrice(mensalDosAdicionais)}/mês em adicionais
                            </span>
                        ) : null}
                    </div>

                    <div className="space-y-2.5">
                        {unidadesLista.map((unidade, indice) => {
                            /* A primeira da conta é a principal: ela é a conta,
                               e não se suspende. A ordem vem do servidor, por
                               data de criação. */
                            const principal = indice === 0
                            const suspensa = Boolean(unidade.suspendedAt)

                            return (
                                <div
                                    key={unidade.id}
                                    className={cn(
                                        'rounded-lg border border-border p-4',
                                        suspensa && 'bg-muted'
                                    )}
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-semibold">{unidade.name}</span>
                                            {principal ? (
                                                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                                                    <Lock className="size-3" />
                                                    Protegida pela conta — {planLabel || 'plano'}
                                                </span>
                                            ) : suspensa ? (
                                                <span className="rounded-full bg-warning-subtle px-2.5 py-1 text-xs font-semibold text-warning-subtle-foreground">
                                                    suspensa
                                                </span>
                                            ) : (
                                                <>
                                                    <span className="rounded-full bg-success-subtle px-2.5 py-1 text-xs font-semibold text-success-subtle-foreground">
                                                        em uso
                                                    </span>
                                                    <span className="rounded-full bg-info-subtle px-2.5 py-1 text-xs font-semibold text-info-subtle-foreground">
                                                        adicional
                                                    </span>
                                                </>
                                            )}
                                        </div>

                                        {!principal ? (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="num text-sm text-muted-foreground">
                                                    <strong className="text-foreground">
                                                        {formatPrice(UNIDADE_ADICIONAL.price)}
                                                    </strong>
                                                    /mês
                                                </span>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={mexendoNaUnidade === unidade.id}
                                                    onClick={() =>
                                                        void mexerNaUnidade(
                                                            unidade.id,
                                                            suspensa ? 'reativar' : 'suspender'
                                                        )
                                                    }
                                                >
                                                    {suspensa ? (
                                                        <>
                                                            <PlayCircle className="size-4" />
                                                            Reativar
                                                        </>
                                                    ) : (
                                                        <>
                                                            <PauseCircle className="size-4" />
                                                            Suspender
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                        ) : (
                                            <span className="num text-sm text-muted-foreground">
                                                incluída no plano
                                            </span>
                                        )}
                                    </div>

                                    <div className="mt-3 grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-md border border-border sm:grid-cols-4 sm:divide-y-0">
                                        {[
                                            ['Agentes', unidade.agentes],
                                            ['Canais', unidade.canais],
                                            ['Conversas', unidade.conversas],
                                            ['Pacientes', unidade.pacientes],
                                        ].map(([rotulo, valor]) => (
                                            <div key={rotulo as string} className="px-3 py-2">
                                                <p className="text-[11px] text-muted-foreground">{rotulo}</p>
                                                <p className="num text-base font-semibold">
                                                    {(valor as number).toLocaleString('pt-BR')}
                                                </p>
                                            </div>
                                        ))}
                                    </div>

                                    <p className="mt-2.5 text-xs text-muted-foreground">
                                        {principal
                                            ? 'É a primeira unidade da conta e não pode ser suspensa. Para encerrar tudo, cancele a assinatura.'
                                            : suspensa
                                              ? 'Fora do ar desde ' +
                                                new Date(unidade.suspendedAt as string).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) +
                                                '. Nada foi apagado, e a contratação que ela ocupava pode ser cancelada.'
                                              : 'Para cancelar esta contratação, suspenda a unidade antes.'}
                                    </p>
                                </div>
                            )
                        })}

                        {/* A CONTRATADA SEM CLÍNICA.
                            É a linha que a homologação do Andre expôs: 3
                            contratadas e 2 cadastradas. Contratar e cadastrar
                            são coisas diferentes, e é aqui que a diferença
                            aparece com preço.

                            O vocabulário é o do negócio, não o de estacionamento:
                            "vaga livre" e "devolver a vaga" saíram a pedido
                            dele. Contrata-se uma unidade adicional; cadastra-se
                            a clínica que a ocupa; cancela-se a contratação. */}
                        {Array.from({ length: Math.max(0, u?.livres ?? 0) }).map((_, i) => (
                            <div
                                key={`disponivel-${i}`}
                                className="rounded-lg border border-dashed border-border bg-muted/40 p-4"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        {/* Contratação, não unidade. A clínica
                                            não nasce do contrato — nasce de um
                                            clique em Nova unidade. Chamar a
                                            linha vazia de "unidade" é o mesmo
                                            embaralhamento que esta tela existe
                                            para desfazer. */}
                                        <span className="font-semibold">Contratação adicional</span>
                                        <span className="rounded-full bg-success-subtle px-2.5 py-1 text-xs font-semibold text-success-subtle-foreground">
                                            livre para uma clínica
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="num text-sm text-muted-foreground">
                                            <strong className="text-foreground">
                                                {formatPrice(UNIDADE_ADICIONAL.price)}
                                            </strong>
                                            /mês
                                        </span>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={processing}
                                            onClick={() => void mexerNaContratacao('cancel-addon')}
                                        >
                                            Cancelar contratação
                                        </Button>
                                    </div>
                                </div>
                                <p className="mt-2.5 text-xs text-muted-foreground">
                                    Você paga por esta contratação e ainda não criou a clínica que
                                    vai ocupá-la. Crie em Conta da Clínica → Nova unidade — ou
                                    cancele a contratação, e a mensalidade cai na renovação
                                    {renovaEm ? `, em ${renovaEm}` : ''}.
                                </p>
                            </div>
                        ))}

                        {/* A CANCELADA QUE AINDA VALE.
                            Cancelar não é instantâneo — o ciclo foi pago —, e
                            foi justamente isso que fez o Andre clicar duas
                            vezes: a tela não mudava. Agora ela muda, mostra até
                            quando vale, e oferece desfazer enquanto dá. */}
                        {Array.from({ length: Math.max(0, u?.cancelados ?? 0) }).map((_, i) => (
                            <div
                                key={`cancelada-${i}`}
                                className="rounded-lg border border-dashed border-border p-4 opacity-90"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-semibold">Contratação adicional</span>
                                        <span className="rounded-full bg-destructive-subtle px-2.5 py-1 text-xs font-semibold text-destructive-subtle-foreground">
                                            cancelada
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="num text-sm text-muted-foreground line-through">
                                            {formatPrice(UNIDADE_ADICIONAL.price)}/mês
                                        </span>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={processing}
                                            onClick={() => void mexerNaContratacao('restore-addon')}
                                        >
                                            Restaurar
                                        </Button>
                                    </div>
                                </div>
                                <p className="mt-2.5 text-xs text-muted-foreground">
                                    Continua valendo até {renovaEm ?? 'a renovação'}, porque o ciclo
                                    já está pago — e dá para abrir uma clínica nela até lá, embora
                                    ela perca a vaga na virada. A partir daí deixa de ser cobrada e
                                    o teto da conta diminui. Restaurar não custa nada.
                                </p>
                            </div>
                        ))}
                    </div>

                </div>
            </RecordDialog>

            {/* Change Plan Modal */}
            <RecordDialog
                open={showPlanModal}
                onOpenChange={setShowPlanModal}
                title="Alterar plano"
                description="A troca vale a partir do próximo ciclo; o que já foi pago continua valendo."
                size="wide"
            >
                <div className="col-span-2 flex min-h-full flex-col gap-3">

                    {/* O aviso de avaliação em uma linha: a versão longa é a da
                        guia, e repetida aqui empurrava os planos para fora. */}
                    {isTrialing && (
                        <p className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-[12.5px]">
                            <Gift className="size-4 shrink-0 text-primary" />
                            <span>
                                Em avaliação: faltam <strong>{trialDaysLeft} dias</strong> e você tem{' '}
                                <strong>{subscription?.credits?.toLocaleString('pt-BR')} créditos</strong>. Nada é
                                cobrado até efetivar a assinatura.
                            </span>
                        </p>
                    )}

                    {/* Plan Cards */}
                    <div className="grid flex-1 grid-cols-1 items-stretch gap-3 md:grid-cols-3">
                        {(['flow', 'pro', 'advanced'] as const).map((planKey) => {
                            const plan = subscription?.plans[planKey]
                            if (!plan) return null

                            const isSelected = selectedPlan === planKey
                            const isCurrent = subscription?.plan === planKey
                            const isPopular = planKey === 'pro'

                            return (
                                <div
                                    key={planKey}
                                    onClick={() => setSelectedPlan(planKey)}
                                    className={cn(
                                        'relative flex flex-col rounded-xl border p-4 transition-colors',
                                        isSelected
                                            ? 'border-primary bg-primary-subtle/40'
                                            : 'border-border bg-card hover:border-border-strong',
                                        !isCurrent && 'cursor-pointer'
                                    )}
                                >
                                    {isPopular && (
                                        <span className="absolute -top-2.5 left-4 rounded-full bg-brand-accent px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand-accent-foreground">
                                            Mais popular
                                        </span>
                                    )}
                                    {isCurrent && (
                                        <span className="absolute -top-2.5 right-4 rounded-full bg-primary-subtle px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-primary-subtle-foreground">
                                            Atual
                                        </span>
                                    )}

                                    {/* Sem a plaquinha colorida atrás: ela existia
                                        para dar corpo a um glifo monocromático do
                                        Lucide, e por baixo de um ícone que já tem
                                        degradê próprio ela só brigava. */}
                                    <div className="flex items-center gap-2">
                                        {/* Dois arquivos, um por tema: o degradê rico da marca some no
                                            cartão escuro, que é marinho. Trocados por CSS e não por
                                            estado, para não piscar o ícone errado antes de o tema ser
                                            conhecido — `next-themes` só resolve depois de montar. O
                                            `alt` vazio nos dois porque o nome do plano está escrito ao
                                            lado: um leitor de tela que anunciasse o ícone diria o nome
                                            duas vezes. */}
                                        <img src={plan.icon} alt="" width={32} height={32} className="size-8 shrink-0 dark:hidden" />
                                        <img src={plan.iconDark} alt="" width={32} height={32} className="hidden size-8 shrink-0 dark:block" />
                                        <h3 className="text-[15px] font-bold">{plan.name}</h3>
                                    </div>

                                    <p className="mt-2">
                                        <span className="num text-2xl font-bold">
                                            R$ {plan.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </span>
                                        <span className="text-xs text-muted-foreground"> /mês</span>
                                    </p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">{plan.description}</p>

                                    {/* "Conexões disponíveis", com o glifo real
                                        de cada rede. Antes eram quatro ícones
                                        genéricos do Lucide — um QR Code e um selo
                                        de verificação para as duas formas de
                                        conectar o WhatsApp —, e ninguém entendia
                                        o que eram. A lista aqui é comercial: as
                                        duas formas de conectar o WhatsApp são o
                                        WhatsApp. A técnica, com as duas
                                        separadas, continua no painel. */}
                                    <div className="mt-2.5 border-t border-border pt-2.5">
                                        <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                                            Conexões disponíveis
                                        </p>
                                        <div className="mt-1.5 flex items-center gap-1.5">
                                            {redesDoPlano(planKey).map((rede) => {
                                                const RedeIcon = rede.icon
                                                return (
                                                    <span
                                                        key={rede.id}
                                                        title={rede.emBreve ? `${rede.label} — em breve` : rede.label}
                                                        /* Todos na mesma cor: o esmaecido do "em
                                                           breve" sujava a fileira. Que o canal ainda
                                                           não existe segue dito no `title` e no rótulo
                                                           de leitor de tela — e a lista de itens logo
                                                           abaixo é quem promete de verdade. */
                                                        className="relative flex size-8 items-center justify-center rounded-md bg-muted text-foreground"
                                                    >
                                                        <RedeIcon className="size-4" />
                                                        {/* A marca no canto distingue as duas conexões da mesma rede: o
                                                            WhatsApp entra por QR Code ou pela API oficial, e são produtos
                                                            diferentes para a clínica. Sem ela, dois ícones idênticos lado a
                                                            lado — pior que não mostrar. O nome inteiro está no `title` e no
                                                            rótulo de leitor de tela; a marca é só a pista visual. */}
                                                        {rede.marca ? (
                                                            <span className="absolute -bottom-0.5 -right-1 rounded-sm bg-foreground px-[3px] text-[7px] font-bold leading-[1.35] tracking-tight text-background">
                                                                {rede.marca}
                                                            </span>
                                                        ) : null}
                                                        <span className="sr-only">
                                                            {rede.label}
                                                            {rede.emBreve ? ' (em breve)' : ''}
                                                        </span>
                                                    </span>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    <ul className="mt-2.5 space-y-1 border-t border-border pt-2.5">
                                        {plan.features.map((feature, idx: number) => (
                                            <li key={idx} className="flex items-start gap-1.5 text-[12.5px] leading-snug">
                                                <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                                                <span className={feature.strong ? 'font-semibold' : undefined}>
                                                    {feature.text}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>

                                    {/* `mt-auto`: o botão fica no pé do cartão, na
                                        mesma linha nos três, mesmo com listas de
                                        tamanhos diferentes. */}
                                    {/* `pt-3.5` junto do `mt-auto`: o `mt-auto`
                                        empurra o botão para o pé do cartão, mas
                                        no cartão mais cheio não sobra nada para
                                        empurrar e o botão encostava no último
                                        item. O padding garante o respiro nos
                                        três, cheios ou não. */}
                                    {/* O respiro é do invólucro, não do botão:
                                        `pt` no próprio botão engordaria o botão
                                        por dentro em vez de afastá-lo da lista.
                                        `mt-auto` leva o invólucro ao pé do
                                        cartão, e o `pt-4` garante o espaço nos
                                        três — inclusive no mais cheio, onde não
                                        sobra folga para o `mt-auto` distribuir. */}
                                    <div className="mt-auto pt-4">
                                        {/* `ArrowUpDown` é o mesmo ícone de
                                            "Alterar plano" na guia, porque é a
                                            mesma ação: mover-se entre planos. O
                                            cartão atual troca por um `Check`,
                                            que diz "é este que você tem" em vez
                                            de oferecer o que já está feito. */}
                                        <Button
                                            className="w-full"
                                            variant={isPopular && !isCurrent ? 'default' : 'outline'}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setSelectedPlan(planKey)
                                                void handleChangePlan(planKey)
                                            }}
                                            disabled={isCurrent || processing}
                                        >
                                            {isCurrent ? <Check className="size-4" /> : <ArrowUpDown className="size-4" />}
                                            {isCurrent ? 'Plano atual' : 'Contratar'}
                                        </Button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </RecordDialog>

            {/* Comprar adicionais: crédito e unidade na mesma tela */}
            <RecordDialog
                open={showCreditsModal}
                onOpenChange={setShowCreditsModal}
                title="Comprar adicionais"
                description="Dois adicionais, de naturezas diferentes: crédito é compra única, válida por 90 dias; unidade soma à mensalidade enquanto existir. Pode levar um, o outro, ou os dois."
                submitLabel="Comprar adicionais"
                submitDisabled={!pacote && unidadesEscolhidas === 0}
                hideAgain
                onSubmit={handleBuyAddons}
                submitting={processing}
                summary={
                    <>
                        {/* Dois subtotais, nunca uma soma.
                            "R$ 184 uma vez" e "R$ 290 por mês" não são
                            parcelas da mesma coisa — somá-las num número
                            daria a conta que o cliente vai contestar na
                            fatura. Decisão do Andre, e é a certa. */}
                        <SummaryCard className="flex-col items-start gap-1">
                            <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                                Agora, uma vez
                            </span>
                            <span className="num text-lg font-bold">{formatPrice(aPagarAgora)}</span>
                            <span className="num text-[11px] text-muted-foreground">
                                {pacote
                                    ? `${pacote.credits.toLocaleString('pt-BR')} créditos · 90 dias`
                                    : 'nenhum crédito escolhido'}
                            </span>
                        </SummaryCard>

                        <SummaryCard className="flex-col items-start gap-1">
                            <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                                A mais, por mês
                            </span>
                            <span className="num text-lg font-bold">{formatPrice(aPagarPorMes)}</span>
                            <span className="num text-[11px] text-muted-foreground">
                                {unidadesEscolhidas > 0
                                    ? `${unidadesEscolhidas} unidade${unidadesEscolhidas === 1 ? '' : 's'} · enquanto existir${unidadesEscolhidas === 1 ? '' : 'em'}`
                                    : 'nenhuma unidade escolhida'}
                            </span>
                        </SummaryCard>
                        {/* QUANDO NÃO HÁ COBRANÇA, DIGA ANTES.
                            Conta vitalícia (ou antes da data de início) recebe
                            o adicional sem passar pelo checkout — é a regra, e
                            está certa. O que estava errado era a tela avisar
                            depois: quem testa cobrança clica, recebe e conclui
                            que o gateway falhou. Foi o que aconteceu com o
                            Andre em 2026-10-19. */}
                        {regimeSemCobranca ? (
                            <p className="rounded-md bg-info-subtle px-3 py-2 text-[11px] font-medium leading-snug text-info-subtle-foreground">
                                {regimeSemCobranca} O adicional entra na hora, sem checkout.
                            </p>
                        ) : subscription?.paymentMethod ? (
                            <p className="num flex items-center gap-2 text-[11px] text-muted-foreground">
                                <CreditCard className="size-3.5" /> •••• {subscription.paymentMethod.last4}
                            </p>
                        ) : null}
                        {regimeSemCobranca ? null : (
                            <button
                                type="button"
                                onClick={() => { setShowCreditsModal(false); setShowPaymentModal(true) }}
                                className="w-fit text-[11px] font-semibold text-primary-subtle-foreground underline-offset-2 hover:underline"
                            >
                                Pagar de outra forma
                            </button>
                        )}
                    </>
                }
            >
                {/* Três cartões, na mesma linguagem visual dos cartões de plano
                    logo acima: preço grande, papel do pacote em uma linha, o que
                    vem embaixo, e o estado de escolhido na borda. Três e não
                    cinco porque cinco espalham a decisão — cada um destes tem um
                    papel, e o maior é também o sinal de que está na hora de
                    trocar de plano. */}
                <p className="col-span-2 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                    Créditos de IA — compra única
                </p>

                <div
                    className="col-span-2 grid gap-3 sm:grid-cols-3"
                    role="radiogroup"
                    aria-label="Pacote de créditos"
                >
                    {pacotes.map((p) => {
                        const escolhido = p.credits === pacoteEscolhido
                        return (
                            <button
                                key={p.credits}
                                type="button"
                                role="radio"
                                aria-checked={escolhido}
                                /* Clicar no escolhido desmarca: quem só quer
                                   unidade precisa poder sair do crédito, e um
                                   radiogroup sem saída obrigaria a fechar o
                                   diálogo e reabrir. */
                                onClick={() => setPacoteEscolhido(escolhido ? null : p.credits)}
                                className={cn(
                                    'group relative flex flex-col rounded-lg border p-4 text-left transition-all',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    escolhido
                                        ? 'border-primary bg-primary-subtle shadow-sm'
                                        : 'border-border bg-card hover:border-primary/40 hover:shadow-sm'
                                )}
                            >
                                {p.discount > 0 ? (
                                    <span className="absolute -top-2 right-3 rounded-full bg-success-subtle px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-success-subtle-foreground">
                                        −{Math.round(p.discount * 100)}%
                                    </span>
                                ) : null}

                                <span className="num text-2xl font-bold leading-none">
                                    {(p.credits / 1000).toLocaleString('pt-BR')} mil
                                </span>
                                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                    créditos
                                </span>

                                <span className="num mt-3 text-lg font-semibold">
                                    R$ {p.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </span>

                                <span className="mt-2 border-t border-border pt-2 text-[12px] leading-snug text-muted-foreground">
                                    {p.pitch}
                                </span>

                                {/* `mt-auto`: a marca de escolhido fica no pé nos
                                    três cartões, mesmo com frases de alturas
                                    diferentes. */}
                                <span
                                    className={cn(
                                        'mt-auto flex items-center gap-1.5 pt-3 text-[12px] font-semibold',
                                        escolhido ? 'text-primary-subtle-foreground' : 'text-muted-foreground'
                                    )}
                                >
                                    <Check
                                        className={cn('size-3.5', escolhido ? 'opacity-100' : 'opacity-0')}
                                        aria-hidden="true"
                                    />
                                    {escolhido ? 'Escolhido' : 'Escolher'}
                                </span>
                            </button>
                        )
                    })}
                </div>

                <p className="col-span-2 text-[11.5px] leading-snug text-muted-foreground">
                    Os créditos comprados entram num lote próprio, com validade de 90 dias, e são
                    gastos <strong>depois</strong> da franquia do plano — que essa sim é descartada a
                    cada renovação. Nada é cobrado de novo quando o lote vence.
                </p>

                <p className="col-span-2 mt-2 border-t border-border pt-4 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                    Unidades adicionais — por mês
                </p>

                {/* Um cartão só, com contador — e não três cartões de "1, 2, 3
                    unidades". Unidade não tem faixa de desconto (decisão do
                    Andre): o preço é linear, R$ 290 cada, então o que varia é
                    uma quantidade, e quantidade se digita num contador. Três
                    cartões com o mesmo preço por unidade seriam três formas de
                    dizer a mesma coisa. */}
                <div className="col-span-2 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
                    <div className="min-w-[14rem] flex-1">
                        <p className="flex items-baseline gap-2">
                            <span className="num text-2xl font-bold leading-none">
                                {formatPrice(UNIDADE_ADICIONAL.price)}
                            </span>
                            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                por unidade, por mês
                            </span>
                        </p>
                        <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
                            {UNIDADE_ADICIONAL.pitch}
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label="Menos uma unidade"
                            disabled={unidadesEscolhidas === 0}
                            onClick={() => setUnidadesEscolhidas((n) => Math.max(0, n - 1))}
                        >
                            <Minus className="size-4" />
                        </Button>
                        {/* `aria-live`: quem usa leitor de tela precisa ouvir o
                            número novo sem sair do botão que acabou de apertar. */}
                        <span
                            className="num w-10 text-center text-xl font-bold"
                            aria-live="polite"
                            aria-label={`${unidadesEscolhidas} unidades adicionais`}
                        >
                            {unidadesEscolhidas}
                        </span>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label="Mais uma unidade"
                            disabled={unidadesEscolhidas >= 10}
                            onClick={() => setUnidadesEscolhidas((n) => Math.min(10, n + 1))}
                        >
                            <Plus className="size-4" />
                        </Button>
                    </div>
                </div>

                <p className="col-span-2 text-[11.5px] leading-snug text-muted-foreground">
                    Cada unidade adicional é <strong>uma clínica a mais na sua conta</strong>,
                    com agenda, pacientes e conversas próprios, mais 1 agente e 1 número de
                    WhatsApp. O crédito continua saindo da franquia do plano — se precisar de
                    mais, compre avulso acima. <strong>Soma à mensalidade enquanto
                    existir</strong>, diferente do crédito, que é uma vez. Depois de contratar,
                    dê nome à clínica em <strong>Conta da Clínica</strong>. Até 10 por compra.
                </p>
            </RecordDialog>


            {/* Payment Method Modal */}
            <RecordDialog
                open={showPaymentModal}
                onOpenChange={setShowPaymentModal}
                title="Forma de pagamento"
                description="O cartão que cobra a mensalidade, e como pagar o resto."
                submitLabel="Tornar padrão"
                submitDisabled={!cartaoEscolhido || processing}
                submitting={processing}
                onSubmit={() => { void handleSetCard() }}
            >
                <div className="col-span-2 space-y-4">
                    {/* A MENSALIDADE: cartão, e só cartão.
                        Não é escolha nossa — cobrar sozinho todo mês exige
                        credencial guardada, e o Asaas recusa Pix e boleto em
                        cobrança recorrente. */}
                    <div>
                        <p className="text-sm font-semibold">Mensalidade</p>
                        <p className="text-xs text-muted-foreground">
                            A cobrança que se repete todo mês vai no cartão de crédito — Pix e
                            boleto não cobram sozinhos.
                        </p>

                        {(subscription?.cartoes?.length ?? 0) > 0 ? (
                            <div className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
                                {subscription?.cartoes?.map((c) => {
                                    /* Quem é o padrão vem gravado, e não de
                                       comparar bandeira e quatro dígitos: dois
                                       "Visa ••••4242" empatariam na comparação. */
                                    const emUso = c.isDefault
                                    return (
                                        <label
                                            key={c.id}
                                            className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-accent"
                                        >
                                            <input
                                                type="radio"
                                                name="cartao"
                                                className="accent-primary"
                                                checked={cartaoEscolhido === c.asaasToken}
                                                onChange={() => setCartaoEscolhido(c.asaasToken)}
                                            />
                                            <CreditCard className="size-4 text-muted-foreground" />
                                            <span className="text-sm">
                                                {c.brand ?? 'Cartão'}{' '}
                                                <span className="num text-muted-foreground">
                                                    ••••{c.last4 ?? '????'}
                                                </span>
                                            </span>
                                            {emUso ? (
                                                <span className="ml-auto rounded-full bg-success-subtle px-2 py-0.5 text-[11px] font-semibold text-success-subtle-foreground">
                                                    padrão
                                                </span>
                                            ) : null}
                                        </label>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="mt-3 rounded-lg border border-dashed border-input p-5 text-center">
                                <CreditCard className="mx-auto size-8 text-muted-foreground" />
                                <p className="mt-2 text-sm font-medium">Nenhum cartão conhecido ainda</p>
                            </div>
                        )}

                        {/* Por que não há campo de número de cartão aqui.
                            A frase é curta de propósito: quem abre esta tela
                            quer trocar o cartão, não ler sobre PCI. O que ela
                            precisa saber é **como** o cartão novo entra. */}
                        {/* COMO UM CARTÃO NOVO ENTRA.
                            Não há campo de número aqui, e não é limitação de
                            prazo: o número do cartão nunca passa por esta
                            aplicação (ver PRODUCT.md §13). O cartão se cadastra
                            **pagando** — é assim que o Asaas nos devolve um
                            token, e é com o token que a troca acontece.

                            Quando existe cobrança em aberto, o caminho é um
                            clique; quando não existe, a frase diz quando vai
                            existir, em vez de prometer um botão que não há. */}
                        <div className="mt-3 rounded-lg bg-muted p-3">
                            <p className="text-xs font-semibold">Adicionar outro cartão</p>
                            {faturaEmAberto ? (
                                <>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Pague a cobrança em aberto com o cartão novo: ele passa a
                                        aparecer nesta lista e pode virar o padrão.
                                    </p>
                                    <a
                                        href={faturaEmAberto}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-2 inline-flex h-9 items-center gap-2 rounded-md border border-input bg-card px-3 text-[13px] font-semibold hover:bg-accent"
                                    >
                                        <CreditCard className="size-4" />
                                        Pagar com outro cartão
                                    </a>
                                </>
                            ) : (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Sem cobrança em aberto agora. Na próxima — a renovação de{' '}
                                    {renovaEm ?? 'cada mês'} — escolha &ldquo;cartão de
                                    crédito&rdquo; na página do Asaas e use o cartão que quiser:
                                    ele aparece aqui depois.
                                </p>
                            )}
                            <p className="mt-2 text-[11px] text-muted-foreground">
                                O número do cartão nunca passa pelo OdontoBox360 — quem o recebe é
                                a página do Asaas.
                            </p>
                        </div>
                    </div>

                    {/* AS COMPRAS AVULSAS: três meios, e a diferença entre eles
                        é tempo. Dizer isso aqui evita a pergunta "comprei e
                        não recebi" de quem pagou boleto. */}
                    <div className="rounded-lg border border-border p-4">
                        <p className="text-sm font-semibold">Créditos e unidades adicionais</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Compra única aceita <strong>Pix</strong>, <strong>cartão</strong> e{' '}
                            <strong>boleto</strong> — você escolhe na hora de pagar. Pix e cartão
                            confirmam em segundos; boleto leva de um a três dias úteis, e a entrega
                            acontece quando o pagamento confirma.
                        </p>
                    </div>
                </div>
            </RecordDialog>


            {/* Cancelar não é um "tem certeza?": é a operação mais cara da
                tela. O quadro diz até quando o plano vale e o que acontece
                depois, e só libera o botão quando a pessoa digita o próprio
                e-mail — o mesmo que o servidor confere. */}

        </BandLayout>
    )
}
