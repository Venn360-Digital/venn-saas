'use client'

import { useCallback, useEffect, useState } from 'react'
import { MailCheck, RotateCw, X } from 'lucide-react'
import { toast } from 'sonner'

import { ROTULO_DO_PAPEL } from '../../lib/papeis'
import { Button } from '@venn/ui/button'
import { cn } from '@venn/ui/utils'

/**
 * Os convites que ainda não foram aceitos — acima da tabela da equipe.
 *
 * ## Por que não é uma guia, nem uma linha na tabela
 *
 * Convite **não é usuário**: não tem foto, não tem departamento efetivo, não
 * tem disponibilidade, não pode ser desativado nem excluído. Misturá-lo às
 * linhas da equipe daria uma tabela em que metade das colunas está vazia em
 * metade das linhas, e em que "Excluir" significa duas coisas diferentes.
 *
 * E uma guia separada esconderia justamente o que precisa ser visto: convite
 * pendente é trabalho inacabado. Quem abre a tela de Usuários depois de
 * convidar alguém quer saber se a pessoa entrou — e é essa a pergunta que esta
 * faixa responde sem ser procurada.
 *
 * **Só aparece quando há o que mostrar.** Sem convite pendente ela não ocupa um
 * pixel: uma clínica com a equipe estável veria para sempre um bloco vazio
 * dizendo "nenhum convite", que é ruído com aparência de informação.
 *
 * ## Os aceitos não entram
 *
 * A lista vem com os aceitos e revogados também — a rota devolve os 100 mais
 * recentes —, e a tela mostra **só os pendentes**. Quem aceitou já está na
 * tabela de baixo, com mais informação; mostrá-lo duas vezes faria a equipe
 * parecer maior do que é.
 */

interface Convite {
    id: string
    email: string
    role: string
    estado: 'pendente' | 'aceito' | 'revogado' | 'expirado'
    expiresAt: string
    convidadoPor: string | null
}

/** Quanto falta, em palavras. O prazo é de 7 dias (ver `lib/convite/estado`). */
function prazo(expiresAt: string): { texto: string; urgente: boolean } {
    const resta = new Date(expiresAt).getTime() - Date.now()
    if (resta <= 0) return { texto: 'expirou', urgente: true }
    const dias = Math.ceil(resta / 86_400_000)
    if (dias <= 1) return { texto: 'expira hoje', urgente: true }
    return { texto: `${dias} dias`, urgente: dias <= 2 }
}

export function ConvitesPendentes({ podeGerenciar }: { podeGerenciar: boolean }) {
    const [convites, setConvites] = useState<Convite[]>([])
    const [agindo, setAgindo] = useState<string | null>(null)

    const buscar = useCallback(async () => {
        try {
            const res = await fetch('/api/convites')
            if (!res.ok) return
            const dados = (await res.json()) as { convites?: Convite[] }
            setConvites((dados.convites ?? []).filter((c) => c.estado === 'pendente'))
        } catch (erro) {
            // Falhar aqui não pode derrubar a tela de Usuários: a faixa some, a
            // tabela fica. Convite invisível tem conserto (recarregar); tela de
            // equipe que não abre, não.
            console.error('[CONVITES] listar', erro)
        }
    }, [])

    useEffect(() => {
        void buscar()
    }, [buscar])

    async function agir(id: string, acao: 'reenviar' | 'revogar') {
        setAgindo(id)
        try {
            const res = await fetch(`/api/convites/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ acao }),
            })
            const dados = (await res.json().catch(() => null)) as { error?: string } | null
            if (!res.ok) throw new Error(dados?.error || 'Não foi possível concluir')

            toast.success(
                acao === 'reenviar'
                    ? 'Convite reenviado. O link anterior deixou de valer.'
                    : 'Convite cancelado.'
            )
            await buscar()
        } catch (erro) {
            toast.error(
                erro instanceof Error && erro.message ? erro.message : 'Não foi possível concluir'
            )
        } finally {
            setAgindo(null)
        }
    }

    if (!convites.length) return null

    return (
        <div className="border-b">
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
                <MailCheck className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-xs font-semibold">
                    {convites.length === 1
                        ? '1 convite aguardando aceite'
                        : `${convites.length} convites aguardando aceite`}
                </h3>
            </div>

            <ul className="divide-y border-t">
                {convites.map((c) => {
                    const { texto, urgente } = prazo(c.expiresAt)
                    const ocupado = agindo === c.id
                    return (
                        <li
                            key={c.id}
                            className="flex items-center gap-3 px-3 py-2 text-xs"
                        >
                            <span className="min-w-0 flex-1 truncate font-medium">{c.email}</span>

                            <span className="shrink-0 text-muted-foreground">
                                {ROTULO_DO_PAPEL[c.role as keyof typeof ROTULO_DO_PAPEL] ?? c.role}
                            </span>

                            {/* O prazo em âmbar quando aperta. É o único dado
                                desta linha que muda sozinho, e por isso é o
                                único que ganha cor. */}
                            <span
                                className={cn(
                                    'shrink-0 tabular-nums',
                                    urgente
                                        ? 'font-semibold text-warning-subtle-foreground'
                                        : 'text-muted-foreground'
                                )}
                            >
                                {texto}
                            </span>

                            {c.convidadoPor ? (
                                <span className="hidden shrink-0 text-muted-foreground sm:inline">
                                    por {c.convidadoPor}
                                </span>
                            ) : null}

                            {podeGerenciar ? (
                                <span className="flex shrink-0 items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 gap-1 px-1.5 text-[11px]"
                                        disabled={ocupado}
                                        onClick={() => void agir(c.id, 'reenviar')}
                                    >
                                        <RotateCw className="size-3" aria-hidden="true" />
                                        Reenviar
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 gap-1 px-1.5 text-[11px] text-destructive-subtle-foreground hover:text-destructive-subtle-foreground"
                                        disabled={ocupado}
                                        onClick={() => void agir(c.id, 'revogar')}
                                    >
                                        <X className="size-3" aria-hidden="true" />
                                        Cancelar
                                    </Button>
                                </span>
                            ) : null}
                        </li>
                    )
                })}
            </ul>
        </div>
    )
}
