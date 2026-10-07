'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TERMS, TERMS_VERSION } from '@/lib/terms'

interface Step5TermsProps {
    onFinish: () => void
    onBack: () => void
    loading?: boolean
}

/**
 * The agreement, before the workspace exists rather than buried in a footer
 * afterwards. The accept box stays disabled until the text has been scrolled to
 * the end: an acceptance nobody could have read is not worth recording.
 */
export function Step5Terms({ onFinish, onBack, loading = false }: Step5TermsProps) {
    const [accepted, setAccepted] = useState(false)
    const [reachedEnd, setReachedEnd] = useState(false)

    function handleScroll(e: React.UIEvent<HTMLDivElement>) {
        const el = e.currentTarget
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 32) setReachedEnd(true)
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-h2">Termos do acordo</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Leia antes de começar. Versão {TERMS_VERSION}.
                </p>
            </div>

            <ScrollArea
                className="h-72 rounded-lg border border-border bg-card"
                onScrollCapture={handleScroll}
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

            <div className="flex items-start gap-3 rounded-lg border border-border p-4">
                <Checkbox
                    id="accept-terms"
                    checked={accepted}
                    onCheckedChange={(v) => setAccepted(v === true)}
                    disabled={!reachedEnd}
                    className="mt-0.5"
                />
                <Label
                    htmlFor="accept-terms"
                    className="text-sm leading-relaxed font-normal"
                >
                    Li e aceito os termos acima, incluindo o período de avaliação de 7 dias e
                    as regras de créditos e de retenção de dados.
                    {!reachedEnd ? (
                        <span className="mt-1 block text-xs text-muted-foreground">
                            Role o texto até o fim para habilitar.
                        </span>
                    ) : null}
                </Label>
            </div>

            <div className="flex justify-between gap-3">
                <Button type="button" variant="outline" onClick={onBack} disabled={loading}>
                    Voltar
                </Button>
                <Button type="button" onClick={onFinish} disabled={!accepted || loading}>
                    {loading ? <Loader2 className="animate-spin" /> : null}
                    Aceitar e começar
                </Button>
            </div>
        </div>
    )
}
