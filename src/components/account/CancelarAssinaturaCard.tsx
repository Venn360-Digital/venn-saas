'use client'

import { useCallback, useEffect, useState } from 'react'
import { Ban, Check, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/shared/FormField'
import { RecordDialog, SummaryCard } from '@/components/shared/RecordDialog'
import { SettingsCard, SettingsRow } from '@/components/shared/TabsFrame'
import { BILLING_UPDATED } from '@/components/layout/AppSidebar'

/**
 * Encerrar a conta — e por que mora aqui, na Conta da Clínica.
 *
 * Passou por três lugares em um dia, e cada mudança teve uma razão:
 *
 * Nasceu na guia **Plano**, como mais um cartão abaixo de "alterar plano" e
 * "comprar adicionais". O Andre tirou de lá com o argumento certo: cancelar é
 * **mais amplo que o plano** — encerra a conta inteira, não a linha de
 * cobrança.
 *
 * Foi para o rodapé de **Alterar unidades**, onde era a saída do caminho
 * "não quero mais". Confundia: uma tela que fala de suspender e contratar
 * unidade não é lugar para encerrar tudo, e a proximidade sugeria que as duas
 * ações são do mesmo tamanho.
 *
 * Fica na **Conta da Clínica**, no fim, depois do acordo. É a guia da conta, o
 * acordo é o que se está encerrando, e o fim da tela é onde mora o que não tem
 * volta — mesmo lugar que a exclusão do agente ocupa na tela dele.
 *
 * Busca o que precisa por conta própria: é um cartão que aparece numa guia que
 * não sabe nada de cobrança, e passar seis propriedades por três níveis para
 * mostrar uma data seria acoplar as duas telas por causa de um cartão.
 */

interface Resumo {
    planName: string | null
    credits: number
    currentPeriodEnd: string | null
    trialEndsAt: string | null
    status: string
}

export function CancelarAssinaturaCard() {
    const [resumo, setResumo] = useState<Resumo | null>(null)
    const [adminEmail, setAdminEmail] = useState('')
    const [aberto, setAberto] = useState(false)
    const [digitado, setDigitado] = useState('')
    const [enviando, setEnviando] = useState(false)

    useEffect(() => {
        let cancelado = false

        void Promise.all([
            fetch('/api/account/subscription').then((r) => (r.ok ? r.json() : null)),
            fetch('/api/account/profile').then((r) => (r.ok ? r.json() : null)),
        ])
            .then(([assinatura, perfil]) => {
                if (cancelado) return
                if (assinatura) {
                    setResumo({
                        planName: assinatura.planName ?? null,
                        credits: assinatura.credits ?? 0,
                        currentPeriodEnd: assinatura.currentPeriodEnd ?? null,
                        trialEndsAt: assinatura.trialEndsAt ?? null,
                        status: assinatura.status ?? 'none',
                    })
                }
                if (perfil?.email) setAdminEmail(perfil.email)
            })
            .catch(() => {
                // Sem o resumo o cartão ainda cancela: quem confere o e-mail e
                // quem encerra de verdade é o servidor.
            })

        return () => {
            cancelado = true
        }
    }, [])

    /** Até quando o acesso vale: o fim do ciclo pago ou o fim da avaliação. */
    const ate = resumo?.currentPeriodEnd ?? resumo?.trialEndsAt ?? null
    const ateLabel = ate
        ? new Date(ate).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              timeZone: 'America/Sao_Paulo',
          })
        : 'o fim do período já pago'

    /**
     * O e-mail digitado tem de ser o de quem está logado.
     *
     * A conferência também acontece no servidor: uma confirmação que só existe
     * no navegador some com um `fetch` e não protege nada.
     */
    const confere =
        adminEmail.trim().length > 0 &&
        digitado.trim().toLowerCase() === adminEmail.trim().toLowerCase()

    const cancelar = useCallback(async () => {
        setEnviando(true)
        try {
            const res = await fetch('/api/account/subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'cancel', confirmEmail: digitado.trim() }),
            })
            const data = await res.json()

            if (res.ok) {
                toast.success(data.message)
                setAberto(false)
                setDigitado('')
                window.dispatchEvent(new Event(BILLING_UPDATED))
            } else {
                toast.error(data.error || 'Não foi possível cancelar')
            }
        } catch {
            toast.error('Não foi possível cancelar')
        } finally {
            setEnviando(false)
        }
    }, [digitado])

    /** Conta já cancelada não oferece cancelar de novo. */
    if (resumo?.status === 'canceled') {
        return (
            <div className="px-5 py-4 md:px-6">
                <SettingsCard className="max-w-5xl" title="Assinatura cancelada">
                    <SettingsRow
                        title={`O acesso continua até ${ateLabel}`}
                        description="Nada mais será cobrado. Depois dessa data a clínica fica em somente-leitura: o histórico continua inteiro e exportável."
                    />
                </SettingsCard>
            </div>
        )
    }

    return (
        <>
            <div className="px-5 py-4 md:px-6">
                <SettingsCard
                    className="max-w-5xl border-destructive/30"
                    title="Cancelar assinatura"
                    description="Esta ação não tem volta."
                >
                    <SettingsRow
                        title="O acesso continua até o fim do período da assinatura."
                        description="Depois dessa data os agentes param de responder e os números de WhatsApp são desconectados. As conversas e o histórico de mensagens continuam guardados."
                        action={
                            <Button variant="destructive" onClick={() => setAberto(true)}>
                                <Ban className="size-4" />
                                Cancelar assinatura
                            </Button>
                        }
                    />
                </SettingsCard>
            </div>

            <RecordDialog
                open={aberto}
                onOpenChange={(open) => {
                    setAberto(open)
                    if (!open) setDigitado('')
                }}
                title="Cancelar assinatura"
                description="Leia o que muda antes de confirmar."
                submitLabel="Cancelar assinatura"
                hideAgain
                destructive
                submitDisabled={!confere}
                submitting={enviando}
                onSubmit={() => void cancelar()}
                summary={
                    <>
                        <SummaryCard className="flex-col items-start gap-1">
                            <span className="text-[11px] text-muted-foreground">
                                Acesso garantido até
                            </span>
                            <span className="num text-lg font-bold">{ateLabel}</span>
                        </SummaryCard>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                            Até lá nada muda. Depois dessa data os agentes param de responder e os
                            números de WhatsApp são desconectados.
                        </p>
                    </>
                }
            >
                <div className="col-span-2 space-y-4">
                    <div className="rounded-lg border border-border bg-muted/40 p-4">
                        <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                            O que acontece
                        </p>
                        <ul className="mt-2 space-y-2 text-[13px] leading-snug">
                            <li className="flex items-start gap-2">
                                <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                                <span>
                                    O plano <strong>{resumo?.planName ?? '—'}</strong> continua
                                    valendo até <strong className="num">{ateLabel}</strong>. Não há
                                    reembolso do período já pago, e nada é cobrado depois.
                                </span>
                            </li>
                            <li className="flex items-start gap-2">
                                <X className="mt-0.5 size-3.5 shrink-0 text-destructive-subtle-foreground" />
                                <span>
                                    Depois dessa data os agentes param de responder, os números de
                                    WhatsApp são desconectados e os{' '}
                                    <strong className="num">
                                        {(resumo?.credits ?? 0).toLocaleString('pt-BR')}
                                    </strong>{' '}
                                    créditos restantes deixam de valer.
                                </span>
                            </li>
                            <li className="flex items-start gap-2">
                                <X className="mt-0.5 size-3.5 shrink-0 text-destructive-subtle-foreground" />
                                <span>
                                    As unidades adicionais contratadas são encerradas junto, na
                                    mesma data — elas somam à assinatura que está sendo cancelada.
                                </span>
                            </li>
                            <li className="flex items-start gap-2">
                                <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                                <span>
                                    As conversas, os pacientes e os negócios continuam guardados, e
                                    voltam inteiros se a clínica assinar de novo.
                                </span>
                            </li>
                        </ul>
                    </div>

                    <FormField
                        label="Digite o seu e-mail de administrador para confirmar"
                        htmlFor="cancel-confirm-email"
                        required
                        hint={adminEmail ? `A conta em uso é ${adminEmail}.` : undefined}
                        error={
                            digitado.trim() !== '' && !confere
                                ? 'O e-mail não confere com o da conta em uso.'
                                : undefined
                        }
                    >
                        <Input
                            id="cancel-confirm-email"
                            type="email"
                            autoComplete="off"
                            value={digitado}
                            onChange={(e) => setDigitado(e.target.value)}
                            placeholder="voce@clinica.com.br"
                        />
                    </FormField>
                </div>
            </RecordDialog>
        </>
    )
}
