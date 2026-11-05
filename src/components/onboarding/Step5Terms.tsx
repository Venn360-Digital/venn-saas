'use client'

import { useState } from 'react'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TERMS, TERMS_VERSION } from '@/lib/terms'

/**
 * O acordo, antes de o workspace existir.
 *
 * A caixa de aceite segue travada até o texto ter sido rolado até o fim: um
 * aceite que ninguém teve como ler não vale ser registrado.
 *
 * **É o termo da conta, e é aceito uma vez.** Quem o dono cadastra depois em
 * Gerenciamento → Usuários não passa por aqui — não passa pelo cadastro
 * inteiro —, porque o que se assina aqui é o contrato da clínica, não um
 * consentimento de cada pessoa. O portão que fazia o convidado cair no cadastro
 * estava em `GET /api/auth/check-workspace`, que procurava aceite **do usuário**
 * em vez de aceite **da conta**.
 *
 * A altura do texto acompanha a faixa que rola, em vez de ser fixa em 22rem:
 * com um bloco fixo mais o cartão de aceite mais o botão, o passo era mais alto
 * que a tela e o botão de aceitar só existia para quem rolasse até ele.
 */
export function Step5Terms({
    aceito,
    onAceitoChange,
}: {
    aceito: boolean
    onAceitoChange: (aceito: boolean) => void
}) {
    const [chegouAoFim, setChegouAoFim] = useState(false)

    function aoRolar(e: React.UIEvent<HTMLDivElement>) {
        const el = e.currentTarget
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 32) setChegouAoFim(true)
    }

    return (
        <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                    Aceito uma vez, pela conta. Quem você cadastrar depois não passa por aqui.
                </p>
                <p className="num shrink-0 rounded-full border border-border px-2.5 py-0.5 text-[11.5px] text-muted-foreground">
                    Versão {TERMS_VERSION}
                </p>
            </div>


            {/* A altura acompanha a faixa que rola. O cartão da moldura já tem
                altura fixa, então o que esta conta precisa descontar é só o que
                está DENTRO dele: a linha da versão, o cartão de aceite e os
                respiros — ~12rem. Antes descontava 23rem, que era o shell
                inteiro, e o texto ficava com metade da altura que tem. */}
            <ScrollArea
                className="h-[clamp(12rem,calc(100svh-25rem),34rem)] rounded-lg border border-border bg-card"
                onScrollCapture={aoRolar}
            >
                <div className="space-y-4 p-4">
                    {TERMS.map((section) => (
                        <section key={section.title}>
                            <h2 className="text-sm font-semibold">{section.title}</h2>
                            {section.body.map((paragraph) => (
                                <p
                                    key={paragraph}
                                    className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground"
                                >
                                    {paragraph}
                                </p>
                            ))}
                        </section>
                    ))}
                </div>
            </ScrollArea>

            <div className="flex items-start gap-3 rounded-lg border border-border p-3">
                <Checkbox
                    id="accept-terms"
                    checked={aceito}
                    onCheckedChange={(v) => onAceitoChange(v === true)}
                    disabled={!chegouAoFim}
                    className="mt-0.5"
                />
                <Label htmlFor="accept-terms" className="text-[13px] font-normal leading-relaxed">
                    Li e aceito os termos acima, incluindo o período de avaliação de 7 dias e as
                    regras de créditos e de retenção de dados.
                    {!chegouAoFim ? (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                            Role o texto até o fim para habilitar.
                        </span>
                    ) : null}
                </Label>
            </div>
        </div>
    )
}
