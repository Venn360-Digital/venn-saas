'use client'

import { useEffect, useState } from 'react'
import { Check, FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { RecordDialog } from '@/components/shared/RecordDialog'
import { Checkbox } from '@venn/ui/checkbox'
import { Label } from '@venn/ui/label'
import { ScrollArea } from '@venn/ui/scroll-area'
import { useEsperaLonga } from '@/hooks/useEsperaLonga'
import { cn } from '@venn/ui/utils'
import { SectionCard } from '@/components/shared/SectionCard'
import { SettingsBand } from '@/components/shared/TabsFrame'

/** O mesmo contrato do `SectionCard`, desenhado como faixa. */
function BandFrame({
    title,
    description,
    action,
    children,
}: {
    title: string
    description?: React.ReactNode
    action?: React.ReactNode
    children: React.ReactNode
}) {
    return (
        // Sem `last`: o acordo deixou de ser o pé da guia quando o cancelamento
        // passou para depois dele, e sem o fio os dois correm juntos.
        <SettingsBand title={title}>
            {/* O acordo num cartão de bordas arredondadas: a frase do estado e o
                botão de ler ficam na mesma peça, e não soltos no pé da guia.
                Sem teto de largura — cartão em guia acompanha a resolução
                (DESIGN.md §5, "Cartão em guia"). O `max-w-5xl` daqui prendia o
                cartão em 1024px e deixava 569px de vazio à direita numa tela de
                1920; quem recua é a margem do painel, pela `SettingsBand`. */}
            <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">{children}</div>
                    {action ? <div className="shrink-0">{action}</div> : null}
                </div>
                {description ? (
                    <p className="mt-2 text-xs text-muted-foreground">{description}</p>
                ) : null}
            </div>
        </SettingsBand>
    )
}
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
export function TermsCard({ band = false }: { band?: boolean }) {
    const [state, setState] = useState<TermsState | null>(null)
    /** O sinal de espera só depois de 200ms — ver `useEsperaLonga`. */
    const esperaLonga = useEsperaLonga(state === null)
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

    /* Numa guia sangrada o acordo é uma faixa, não um cartão: o cartão
       dentro do cartão do shell cobra duas molduras e empurra o conteúdo
       para fora da tela. */
    const Frame = band ? BandFrame : SectionCard

    /**
     * **A moldura entra, o corpo espera.** Conserto de 2026-11-09, na varredura
     * da "sombra de campos" (DESIGN.md §5).
     *
     * O título é real — o acordo existe, e a faixa vai aparecer de qualquer
     * jeito —, então ele fica. O que era `Skeleton` era a linha do corpo, e
     * ali o cinza não mentia sobre quantidade (vem **uma** linha), só sobre o
     * instante: numa leitura de 80ms ele aparecia e sumia, que é o pisca. Fica
     * vazio abaixo do limiar e diz "carregando" acima dele — o mesmo critério
     * do `DataTable` e das telas do agente.
     */
    if (state === null) {
        return (
            <Frame title="Termos do acordo">
                {esperaLonga ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        Carregando…
                    </p>
                ) : null}
            </Frame>
        )
    }

    const outdated = state.acceptedTerms && state.acceptedVersion !== TERMS_VERSION
    const needsSignature = !state.acceptedTerms || outdated

    return (
        <Frame
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
                    /* O único `default` da guia Plano — ver DESIGN.md §5. O
                       acordo é o que a clínica precisa ter lido, e é a única
                       ação da tela que não é transação. */
                    <Button onClick={() => setReading(true)}>
                        <FileText className="size-4" />
                        Ler os termos
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
                            // Com hora, e não só a data: o que dá valor a um
                            // aceite é ser um registro, e registro sem hora é
                            // meia anotação. O banco guarda em UTC — aqui o
                            // próprio navegador converte para o fuso de quem
                            // lê, que é o único relógio que a pessoa reconhece.
                            <span className="num text-muted-foreground">
                                em{' '}
                                {new Date(state.acceptedAt).toLocaleString('pt-BR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                })}
                            </span>
                        ) : null}
                    </p>
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
                            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                            Autorizar
                        </Button>
                    </div>
                </div>
            )}
            {/* O texto num quadro de diálogo, como todo formulário da casa:
                expandido dentro do cartão ele empurrava o resto da guia para
                baixo de nove parágrafos que ninguém estava procurando. */}
            <RecordDialog
                open={reading}
                onOpenChange={setReading}
                title="Termos do acordo"
                description={`Versão ${state.acceptedVersion ?? TERMS_VERSION}.`}
                size="wide"
            >
                <div className="col-span-2">
                    {/* Altura em viewport: o quadro largo cresce com o conteúdo,
                        e o contrato é o conteúdo que deve ocupar a tela. */}
                    <TermsText className="h-[calc(100svh-15rem)] min-h-[320px]" />
                </div>
            </RecordDialog>
        </Frame>
    )
}

function TermsText({ onReachEnd, className }: { onReachEnd?: () => void; className?: string }) {
    return (
        <ScrollArea
            className={cn('h-72 rounded-lg border border-border', className)}
            onScrollCapture={(e: React.UIEvent<HTMLDivElement>) => {
                if (!onReachEnd) return
                const el = e.currentTarget
                if (el.scrollHeight - el.scrollTop - el.clientHeight < 32) onReachEnd()
            }}
        >
            {/* A leitura num quadro largo: duas colunas de texto cansam menos
                que uma linha de 1000px. */}
            <div className="columns-1 gap-8 space-y-5 p-5 lg:columns-2">
                {TERMS.map((section) => (
                    <section key={section.title} className="break-inside-avoid">
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
