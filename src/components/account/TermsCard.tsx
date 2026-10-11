'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionCard } from '@/components/shared/SectionCard'
import { TERMS, TERMS_VERSION } from '@/lib/terms'

interface TermsState {
    acceptedTerms: boolean
    acceptedVersion: string | null
    acceptedAt: string | null
}

/**
 * O aceite dos termos, dentro de Conta → Plano.
 *
 * Havia um caminho só para assinar — terminar o cadastro —, e ele não serve a
 * quem já opera: conta criada antes da migração que criou `terms_acceptances`
 * não tem aceite porque não havia onde gravar. Por um tempo isso a mandava
 * refazer o onboarding a cada login, passando de novo pelo pareamento por QR de
 * um número em uso. O portão voltou a valer só para frente, e o aceite que
 * faltou se recolhe aqui.
 *
 * Mora no Plano porque é aqui que vivem as outras condições do acordo — o que
 * se paga, o que se gasta, até quando. Termo de uso ao lado de crédito e
 * cobrança é onde alguém procura quando quer reler o que aceitou; num diálogo
 * que aparece no login, não se encontra de novo.
 *
 * A caixa de marcar só acende quando o texto chega ao fim, que é a mesma regra
 * do passo 5 do cadastro: assinatura que ninguém teve como ler não vale
 * registrar.
 */
export function TermsCard() {
    const [state, setState] = useState<TermsState | null>(null)
    const [accepted, setAccepted] = useState(false)
    const [reachedEnd, setReachedEnd] = useState(false)
    const [saving, setSaving] = useState(false)
    const [reading, setReading] = useState(false)

    useEffect(() => {
        let cancelled = false
        fetch('/api/auth/check-workspace')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled) return
                setState({
                    acceptedTerms: Boolean(data?.acceptedTerms),
                    acceptedVersion: data?.acceptedVersion ?? null,
                    acceptedAt: data?.acceptedAt ?? null,
                })
            })
            .catch(() => {
                if (!cancelled) setState(null)
            })
        return () => { cancelled = true }
    }, [])

    const submit = async () => {
        setSaving(true)
        try {
            const res = await fetch('/api/account/terms', { method: 'POST' })
            if (!res.ok) throw new Error()
            setState({
                acceptedTerms: true,
                acceptedVersion: TERMS_VERSION,
                acceptedAt: new Date().toISOString(),
            })
            toast.success('Aceite registrado')
        } catch {
            toast.error('Não foi possível registrar o aceite. Tente de novo.')
        } finally {
            setSaving(false)
        }
    }

    if (state === null) {
        return (
            <SectionCard title="Termos do acordo">
                <Skeleton className="h-5 w-64" />
            </SectionCard>
        )
    }

    const outdated = state.acceptedTerms && state.acceptedVersion !== TERMS_VERSION
    const needsSignature = !state.acceptedTerms || outdated

    return (
        <SectionCard
            title="Termos do acordo"
            description={
                needsSignature
                    ? outdated
                        ? `Os termos mudaram desde o seu aceite. Leia e autorize a versão ${TERMS_VERSION}.`
                        : `Falta o seu aceite. Leia e autorize a versão ${TERMS_VERSION}.`
                    : `Versão ${state.acceptedVersion}.`
            }
            action={
                needsSignature ? null : (
                    <Button variant="outline" size="sm" onClick={() => setReading((v) => !v)}>
                        {reading ? 'Fechar' : 'Ler os termos'}
                    </Button>
                )
            }
        >
            {/* Já assinado: o estado vem primeiro e o texto fica a um clique.
                Quem chega aqui depois de aceitar quer confirmar que aceitou,
                não reler nove parágrafos. */}
            {!needsSignature ? (
                <div className="space-y-4">
                    <p className="flex items-center gap-2 text-sm">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success-subtle">
                            <Check className="size-3 text-success-subtle-foreground" />
                        </span>
                        Aceito
                        {state.acceptedAt ? (
                            <span className="num text-muted-foreground">
                                em{' '}
                                {new Date(state.acceptedAt).toLocaleDateString('pt-BR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                })}
                            </span>
                        ) : null}
                    </p>
                    {reading ? <TermsText /> : null}
                </div>
            ) : (
                <div className="space-y-4">
                    <TermsText onReachEnd={() => setReachedEnd(true)} />

                    <div className="flex items-start gap-3 rounded-lg border border-border p-4">
                        <Checkbox
                            id="plan-accept-terms"
                            checked={accepted}
                            onCheckedChange={(v) => setAccepted(v === true)}
                            disabled={!reachedEnd}
                            className="mt-0.5"
                        />
                        <Label
                            htmlFor="plan-accept-terms"
                            className="text-sm leading-relaxed font-normal"
                        >
                            Li e autorizo os termos acima, incluindo as regras de créditos e de
                            retenção de dados.
                            {!reachedEnd ? (
                                <span className="mt-1 block text-xs text-muted-foreground">
                                    Role o texto até o fim para habilitar.
                                </span>
                            ) : null}
                        </Label>
                    </div>

                    <div className="flex justify-end">
                        <Button onClick={() => void submit()} disabled={!accepted || saving}>
                            {saving ? <Loader2 className="animate-spin" /> : null}
                            Autorizar
                        </Button>
                    </div>
                </div>
            )}
        </SectionCard>
    )
}

function TermsText({ onReachEnd }: { onReachEnd?: () => void }) {
    return (
        <ScrollArea
            className="h-72 rounded-lg border border-border"
            onScrollCapture={(e: React.UIEvent<HTMLDivElement>) => {
                if (!onReachEnd) return
                const el = e.currentTarget
                if (el.scrollHeight - el.scrollTop - el.clientHeight < 32) onReachEnd()
            }}
        >
            <div className="space-y-5 p-5">
                {TERMS.map((section) => (
                    <section key={section.title}>
                        <h3 className="text-h4">{section.title}</h3>
                        {section.body.map((paragraph) => (
                            <p
                                key={paragraph}
                                className="mt-2 text-sm leading-relaxed text-muted-foreground"
                            >
                                {paragraph}
                            </p>
                        ))}
                    </section>
                ))}
            </div>
        </ScrollArea>
    )
}
