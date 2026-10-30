'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/shared/TabsFrame'

/**
 * A fila de aprovação das lacunas.
 *
 * É a metade humana do laço de melhoria: a mineração semanal colhe o que o
 * agente não soube responder, agrupa por assunto, e **propõe**. Quem decide é
 * uma pessoa.
 *
 * ## O que o cartão mostra, e por quê
 *
 * A demanda vem primeiro porque é o que ordena o trabalho: a pergunta que vinte
 * pessoas fizeram vale mais do que a que uma fez. Depois o documento de destino,
 * porque aprovar é escrever ali. E o texto proposto inteiro, porque aprovar sem
 * ler o que vai entrar no acervo da clínica seria o oposto do ponto.
 *
 * ## O aviso que o cartão repete, e que não é redundante
 *
 * O texto proposto tem a **resposta em branco**. A mineração não a escreve, e
 * não é cautela — a lacuna existe porque a resposta não está em lugar nenhum do
 * acervo, então um modelo que a escrevesse estaria inventando preço, horário ou
 * prazo. Aprovar é aceitar a *pergunta*; a resposta é trabalho da clínica.
 *
 * Se alguém aprovar e não escrever, nada daquela seção chega ao agente — o
 * marcador é um comentário de HTML e o acervo descarta comentário. A pergunta
 * volta a aparecer como lacuna na semana seguinte, que é o certo.
 */

interface Sugestao {
    id: string
    question: string
    demand: number
    targetSlug: string
    tituloDoAlvo: string
    draftText: string
    status: 'nova' | 'aprovada' | 'descartada'
    decidedAt: string | null
    createdAt: string
}

export function LacunasTab({ agentId, canManage = true }: { agentId?: string | null; canManage?: boolean }) {
    const [sugestoes, setSugestoes] = useState<Sugestao[] | null>(null)
    const [naoAgrupadas, setNaoAgrupadas] = useState(0)
    const [decidindo, setDecidindo] = useState<string | null>(null)

    const carregar = useCallback(async () => {
        if (!agentId) return
        try {
            const res = await fetch(`/api/agents/${agentId}/lacunas`)
            if (!res.ok) throw new Error(String(res.status))
            const corpo = await res.json()
            setSugestoes(corpo.sugestoes ?? [])
            setNaoAgrupadas(corpo.naoAgrupadas ?? 0)
        } catch {
            setSugestoes([])
            toast.error('Não foi possível carregar a fila de lacunas.')
        }
    }, [agentId])

    useEffect(() => {
        void carregar()
    }, [carregar])

    const decidir = async (id: string, decisao: 'aprovar' | 'descartar') => {
        setDecidindo(id)
        try {
            const res = await fetch(`/api/agents/${agentId}/lacunas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sugestao: id, decisao }),
            })
            const corpo = await res.json().catch(() => null)
            if (!res.ok) throw new Error(corpo?.error ?? String(res.status))

            toast.success(
                decisao === 'aprovar'
                    ? `Entrou como rascunho em "${corpo.titulo}". Escreva a resposta e publique.`
                    : 'Sugestão descartada.'
            )
            await carregar()
        } catch (erro) {
            toast.error(erro instanceof Error ? erro.message : 'Não foi possível decidir agora.')
        } finally {
            setDecidindo(null)
        }
    }

    if (!agentId) {
        return (
            <SettingsCard title="Lacunas" description="Salve o agente para a mineração começar a colher.">
                <p className="text-sm text-muted-foreground">
                    A fila aparece depois do primeiro salvar.
                </p>
            </SettingsCard>
        )
    }

    if (sugestoes === null) {
        return (
            <SettingsCard title="Lacunas" description="O que o agente não soube responder.">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Carregando…
                </p>
            </SettingsCard>
        )
    }

    const novas = sugestoes.filter((s) => s.status === 'nova')
    const decididas = sugestoes.filter((s) => s.status !== 'nova')

    return (
        <div className="flex flex-col gap-4">
            <SettingsCard
                title="Lacunas"
                description="As perguntas que o agente não soube responder, agrupadas por assunto e ordenadas por demanda."
            >
                <div className="flex flex-col gap-3">
                    {/* A distinção entre "nada aconteceu" e "a mineração ainda não
                        rodou" vale dias, porque ela roda uma vez por semana. */}
                    <p className="text-xs text-muted-foreground">
                        {naoAgrupadas === 0
                            ? 'Nenhuma lacuna esperando agrupamento.'
                            : `${naoAgrupadas} lacuna${naoAgrupadas > 1 ? 's' : ''} aguardando a mineração, que roda nas segundas de manhã.`}
                    </p>

                    {novas.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            Nada para aprovar agora.
                        </p>
                    ) : (
                        novas.map((s) => (
                            <div key={s.id} className="rounded-lg border border-border p-3">
                                <div className="flex flex-wrap items-baseline gap-2">
                                    <span className="num rounded bg-primary-subtle px-1.5 py-0.5 text-[11px] font-semibold text-primary-subtle-foreground">
                                        {s.demand}×
                                    </span>
                                    <p className="text-sm font-semibold">{s.question}</p>
                                </div>

                                <p className="mt-1 text-[11px] text-muted-foreground">
                                    entra em <span className="font-semibold">{s.tituloDoAlvo}</span>
                                </p>

                                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-[12px] leading-relaxed">
                                    {s.draftText}
                                </pre>

                                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warning">
                                    <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                                    A resposta vem em branco de propósito: ela não está em lugar nenhum da
                                    base, e é por isso que a pergunta chegou aqui. Escreva e publique —
                                    enquanto o aviso estiver no texto, nada desta seção chega ao agente.
                                </p>

                                {canManage ? (
                                    <div className="mt-3 flex gap-2">
                                        <Button
                                            size="sm"
                                            className="h-8"
                                            disabled={decidindo !== null}
                                            onClick={() => decidir(s.id, 'aprovar')}
                                        >
                                            {decidindo === s.id ? (
                                                <Loader2 className="size-4 animate-spin" />
                                            ) : (
                                                <Check className="size-4" />
                                            )}
                                            Aprovar como rascunho
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-8"
                                            disabled={decidindo !== null}
                                            onClick={() => decidir(s.id, 'descartar')}
                                        >
                                            <Trash2 className="size-4" />
                                            Descartar
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        ))
                    )}
                </div>
            </SettingsCard>

            {decididas.length > 0 ? (
                <SettingsCard
                    title="Já decididas"
                    description="O histórico fica para a próxima mineração não propor o que já foi descartado."
                >
                    <ul className="flex flex-col gap-1.5 text-sm">
                        {decididas.map((s) => (
                            <li key={s.id} className="flex items-baseline justify-between gap-3">
                                <span className="truncate">{s.question}</span>
                                <span
                                    className={
                                        s.status === 'aprovada'
                                            ? 'shrink-0 text-[11px] text-success'
                                            : 'shrink-0 text-[11px] text-muted-foreground'
                                    }
                                >
                                    {s.status}
                                </span>
                            </li>
                        ))}
                    </ul>
                </SettingsCard>
            ) : null}
        </div>
    )
}
