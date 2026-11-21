'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Eye, FileText, Plus } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { ROTULO_DO_ESTADO, ROTULO_DO_TIPO } from '@venn/core/lib/propostas/estados'

import { StatusBadge, type ToneEntry } from './StatusBadge'

/**
 * As propostas de um negócio, dentro da ficha dele.
 *
 * ## Por que isto existe
 *
 * Sem esta aba, só se chega a uma proposta pelo menu Propostas — e quem está
 * olhando um negócio, decidindo o que fazer com ele, teria de sair, buscar pelo
 * número e voltar. O documento nasce do negócio e volta para ele; a ficha é
 * onde a decisão acontece.
 *
 * ## Só lê e leva
 *
 * O editor de itens não vem para cá. Montar proposta é trabalho de tela cheia —
 * são linhas com quatro campos cada — e cabê-lo nos 380px do painel custaria a
 * legibilidade da coisa mais sensível do módulo, que é o valor. Então aqui se
 * vê o estado, o valor, as aberturas, e se clica para abrir.
 *
 * O que **se** faz daqui é criar: o botão abre o diálogo com o negócio já
 * escolhido, que é o caminho natural e era o que faltava.
 */

const TONS: Record<string, ToneEntry> = {
    rascunho: { label: ROTULO_DO_ESTADO.rascunho, tone: 'neutral' },
    em_aprovacao: { label: ROTULO_DO_ESTADO.em_aprovacao, tone: 'warning' },
    aprovada: { label: ROTULO_DO_ESTADO.aprovada, tone: 'info' },
    reprovada: { label: ROTULO_DO_ESTADO.reprovada, tone: 'destructive' },
    enviada: { label: ROTULO_DO_ESTADO.enviada, tone: 'primary' },
    aceita: { label: ROTULO_DO_ESTADO.aceita, tone: 'success' },
    recusada: { label: ROTULO_DO_ESTADO.recusada, tone: 'destructive' },
    expirada: { label: ROTULO_DO_ESTADO.expirada, tone: 'destructive' },
}

interface PropostaDoNegocio {
    id: string
    kind: string
    title: string
    number: number
    currency: string
    currentRevision: {
        version: number
        status: string
        total: string
        ultimoLink: { acceptedAt: string | null; aberturas: number } | null
    } | null
}

export function DealProposals({
    dealId,
    podeCriar,
    onCriar,
}: {
    dealId: string
    podeCriar: boolean
    /** Abre o diálogo de nova proposta com este negócio já escolhido. */
    onCriar?: () => void
}) {
    const [propostas, setPropostas] = useState<PropostaDoNegocio[] | null>(null)

    const buscar = useCallback(async () => {
        /**
         * A lista vem da MESMA rota da tela de Propostas, filtrada por negócio.
         *
         * Uma rota própria "propostas deste negócio" devolveria o mesmo dado por
         * um segundo caminho, com o seu próprio recorte de visibilidade para
         * divergir. `?dealId=` já existe no `GET /api/propostas` por isto.
         */
        const resposta = await fetch(`/api/propostas?dealId=${encodeURIComponent(dealId)}&limit=50`)
        if (!resposta.ok) {
            setPropostas([])
            return
        }
        const corpo = (await resposta.json()) as {
            data?: Array<
                Omit<PropostaDoNegocio, 'currentRevision'> & {
                    currentRevision:
                        | {
                              version: number
                              status: string
                              total: string
                              shares?: Array<{ acceptedAt: string | null; _count: { views: number } }>
                          }
                        | null
                }
            >
        }
        setPropostas(
            (corpo.data ?? []).map((p) => ({
                id: p.id,
                kind: p.kind,
                title: p.title,
                number: p.number,
                currency: p.currency,
                currentRevision: p.currentRevision
                    ? {
                          version: p.currentRevision.version,
                          status: p.currentRevision.status,
                          total: p.currentRevision.total,
                          ultimoLink: p.currentRevision.shares?.[0]
                              ? {
                                    acceptedAt: p.currentRevision.shares[0].acceptedAt,
                                    aberturas: p.currentRevision.shares[0]._count.views,
                                }
                              : null,
                      }
                    : null,
            }))
        )
    }, [dealId])

    useEffect(() => {
        void buscar()
    }, [buscar])

    if (propostas === null) {
        return <p className="px-1 py-6 text-center text-sm text-muted-foreground">Carregando…</p>
    }

    return (
        <div className="space-y-3">
            {propostas.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                    <FileText className="mx-auto size-5 text-muted-foreground" aria-hidden />
                    <p className="mt-2 text-sm font-medium text-foreground">Nenhum documento ainda</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Monte os itens a partir do catálogo e mande o link ao cliente.
                    </p>
                </div>
            ) : (
                <ul className="space-y-2">
                    {propostas.map((p) => {
                        const r = p.currentRevision
                        const valor = r
                            ? Number(r.total).toLocaleString('pt-BR', {
                                  style: 'currency',
                                  currency: p.currency,
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                              })
                            : null
                        return (
                            <li key={p.id}>
                                <Link
                                    href={`/vendas/propostas/${p.id}`}
                                    className="group block rounded-lg border border-border/60 bg-card p-3 transition-colors hover:bg-accent"
                                >
                                    <div className="flex items-baseline justify-between gap-2">
                                        <span className="truncate text-sm font-medium text-foreground">
                                            {ROTULO_DO_TIPO[p.kind as keyof typeof ROTULO_DO_TIPO] ?? p.kind}{' '}
                                            {p.number}
                                        </span>
                                        {valor && (
                                            <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                                                {valor}
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.title}</p>
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        {r && <StatusBadge value={r.status} map={TONS} />}
                                        {r && r.version > 1 && (
                                            <span className="text-xs text-muted-foreground">v{r.version}</span>
                                        )}
                                        {/*
                                         * As aberturas aparecem aqui porque é o
                                         * dado que muda a próxima ligação, e
                                         * esta é a tela em que a próxima ligação
                                         * é decidida. Zero é informação: ele não
                                         * recusou, não abriu.
                                         */}
                                        {r?.ultimoLink && !r.ultimoLink.acceptedAt && (
                                            <span
                                                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                                                title={
                                                    r.ultimoLink.aberturas === 0
                                                        ? 'O cliente ainda não abriu'
                                                        : `${r.ultimoLink.aberturas} abertura(s)`
                                                }
                                            >
                                                <Eye className="size-3" aria-hidden />
                                                {r.ultimoLink.aberturas}
                                            </span>
                                        )}
                                        <ArrowRight
                                            className="ml-auto size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                                            aria-hidden
                                        />
                                    </div>
                                </Link>
                            </li>
                        )
                    })}
                </ul>
            )}

            {podeCriar && onCriar && (
                <Button variant="outline" size="sm" className="w-full" onClick={onCriar}>
                    <Plus className="size-4" aria-hidden />
                    Novo documento
                </Button>
            )}
        </div>
    )
}
