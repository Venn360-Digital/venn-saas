'use client'

import { useCallback, useEffect, useState } from 'react'
import { Eye, Gift, LogIn, ShieldCheck, Unlock } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@venn/core/components/shared/PageHeader'
import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Badge } from '@venn/ui/badge'
import { ConfirmDialog } from '@venn/core/components/shared/ConfirmDialog'
import { useMarca } from '@venn/core/marca-contexto'
import { cn } from '@venn/ui/utils'

/**
 * O console da Venn360: as contas deste app, e o que dá para fazer com elas.
 *
 * Desenho aprovado em 2026-11-05. **É por app** — o banco é por produto, então
 * cada produto tem o seu console, com as contas dele. Visão consolidada
 * exigiria um quarto sistema lendo os bancos de todos, e não é o que ele pediu.
 *
 * A tela só existe para quem é OWNER do workspace marcado `isPlatform`: o item
 * do menu some para todos os outros, e a rota responde 403 — esconder o menu
 * soma ao portão, não o substitui.
 *
 * ## Dois atos, dois botões
 *
 * **Espiar** abre a conta em somente leitura; **Entrar** abre com poder de
 * gravar. O padrão é espiar, e o primário da linha é ele: 80% das perguntas de
 * suporte ("o agente está publicado?", "que plano é esse?") se respondem
 * olhando, e o ato que grava em nome da clínica merece o clique deliberado.
 */

interface Unidade {
    id: string
    nome: string
    pessoas: number
}

interface Conta {
    id: string
    nome: string
    email: string | null
    criadaEm: string
    plano: string | null
    situacao: string | null
    creditos: number
    creditosUsados: number
    avaliacaoAte: string | null
    somenteLeituraDesde: string | null
    /** Já cortada agora — derivada no servidor, pela regra do `lib/billing.ts`. */
    cortada: boolean
    carenciaAte: string | null
    ultimaAtividadeEm: string | null
    daPlataforma: boolean
    unidades: Unidade[]
}

function quando(iso: string | null): string {
    if (!iso) return '—'
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
    if (min < 1) return 'agora'
    if (min < 60) return `há ${min} min`
    const h = Math.floor(min / 60)
    if (h < 24) return `há ${h} h`
    const d = Math.floor(h / 24)
    return d === 1 ? 'ontem' : `há ${d} dias`
}

/** Dia e mês, para "corta em 13/11". */
function diaCurto(iso: string): string {
    return new Date(iso).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'America/Sao_Paulo',
    })
}

/**
 * A situação em uma palavra e uma cor — a tinta, nunca o preenchimento.
 *
 * **Cortada é `cortada`, não "tem `readOnlySince`".** O servidor compara a data
 * com agora, pela mesma regra do `lib/billing.ts`; aqui só se desenha o que ele
 * concluiu. A tela antes acendia "Somente leitura" por existir a coluna, e
 * dizia isso de uma conta que o produto tratava como ativa — o corte estava
 * marcado para onze dias depois.
 *
 * Corte agendado tem crachá próprio: quem opera precisa ver a data **antes**
 * dela chegar, que é quando ainda dá para fazer alguma coisa a respeito.
 */
function Situacao({ conta }: { conta: Conta }) {
    if (conta.cortada) {
        return <Badge variant="warning">Somente leitura</Badge>
    }
    if (conta.somenteLeituraDesde) {
        return (
            <Badge variant="outline">
                Corta em {diaCurto(conta.somenteLeituraDesde)}
            </Badge>
        )
    }
    if (conta.situacao === 'trialing' || (conta.avaliacaoAte && !conta.situacao)) {
        const dias = conta.avaliacaoAte
            ? Math.ceil((new Date(conta.avaliacaoAte).getTime() - Date.now()) / 86_400_000)
            : null
        return (
            <Badge variant="info">
                Avaliação{dias !== null && dias > 0 ? ` · ${dias} dia${dias === 1 ? '' : 's'}` : ''}
            </Badge>
        )
    }
    if (conta.situacao === 'active') return <Badge variant="success">Pagando</Badge>
    if (conta.situacao === 'canceled') return <Badge variant="outline">Cancelada</Badge>
    return <Badge variant="outline">{conta.situacao ?? 'Sem assinatura'}</Badge>
}

export default function PlataformaPage() {
    // A marca desce pelo React: no navegador o registro de módulo não existe
    // (quem o faz roda no servidor). Ver `marca-contexto.tsx`.
    const marca = useMarca()

    const [contas, setContas] = useState<Conta[]>([])
    const [carregando, setCarregando] = useState(true)
    const [semAcesso, setSemAcesso] = useState(false)
    const [busca, setBusca] = useState('')
    const [confirmando, setConfirmando] = useState<{ conta: Conta; unidade: Unidade } | null>(null)
    const [ajustando, setAjustando] = useState<Conta | null>(null)

    const carregar = useCallback(async () => {
        try {
            const res = await fetch('/api/plataforma/contas')
            if (res.status === 403) {
                setSemAcesso(true)
                return
            }
            if (!res.ok) return
            const dados = await res.json()
            setContas(dados.contas ?? [])
        } finally {
            setCarregando(false)
        }
    }, [])

    useEffect(() => {
        void carregar()
    }, [carregar])

    const entrar = async (unidade: Unidade, modo: 'leitura' | 'total') => {
        const res = await fetch('/api/plataforma/assumir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId: unidade.id, modo }),
        })
        if (!res.ok) {
            const erro = await res.json().catch(() => null)
            toast.error(erro?.error ?? 'Não foi possível entrar')
            return
        }
        // Recarga inteira, e não navegação de cliente: o layout do painel é
        // renderizado no servidor e carrega dado de sessão — marca da conta,
        // unidades, papel. Trocar de conta sem recarregar deixaria o cache do
        // Router mostrando a anterior. Ver DESIGN.md §6.
        window.location.assign('/dashboard')
    }

    const filtradas = contas.filter((c) => {
        const t = busca.trim().toLocaleLowerCase('pt-BR')
        if (!t) return true
        return (
            c.nome.toLocaleLowerCase('pt-BR').includes(t) ||
            (c.email ?? '').toLocaleLowerCase('pt-BR').includes(t)
        )
    })

    if (semAcesso) {
        return (
            <>
                <PageHeader title="Plataforma" description="Área da Venn360." />
                <div className="px-4 md:px-6">
                    <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
                        Esta área é da equipe da Venn360.
                    </p>
                </div>
            </>
        )
    }

    const pagando = contas.filter((c) => c.situacao === 'active').length
    const avaliando = contas.filter((c) => c.situacao === 'trialing').length
    const travadas = contas.filter((c) => c.cortada).length

    return (
        <>
            <PageHeader
                title="Contas"
                description="As assinaturas deste app. Entrar numa conta fica registrado."
                count={{ value: contas.length, singular: 'conta', plural: 'contas' }}
                actions={
                    <Input
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder={`Buscar por ${marca.vocabulario.organizacao} ou e-mail`}
                        className="w-64"
                    />
                }
            />

            <div className="space-y-4 px-4 pb-10 md:px-6">
                <div className="grid gap-3 sm:grid-cols-3">
                    <Resumo rotulo="Pagando" valor={pagando} />
                    <Resumo rotulo="Em avaliação" valor={avaliando} />
                    <Resumo rotulo="Somente leitura" valor={travadas} alerta={travadas > 0} />
                </div>

                {/* Cartão do sistema, e não o desenho das telas de índice:
                    aquelas sangram (margem zero, respiro na célula) porque a
                    região inteira é delas. Esta rola dentro de uma tela com
                    `PageHeader` e divide o espaço com os três resumos acima —
                    aqui a tabela **é** um bloco entre outros, e bloco se
                    separa por borda e superfície. Ver DESIGN.md §5. */}
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border bg-muted">
                                <Th>{marca.vocabulario.Organizacao}</Th>
                                <Th>Plano</Th>
                                <Th>Situação</Th>
                                <Th className="text-right">Créditos</Th>
                                <Th>Última atividade</Th>
                                <Th />
                            </tr>
                        </thead>
                        <tbody>
                            {filtradas.map((conta) =>
                                conta.unidades.map((unidade, i) => (
                                    <tr
                                        key={unidade.id}
                                        className={cn(
                                            'border-t border-border',
                                            conta.cortada && 'bg-warning-subtle/40'
                                        )}
                                    >
                                        <td className="px-4 py-2.5">
                                            {i === 0 ? (
                                                <>
                                                    <span className="block text-sm font-semibold text-foreground">
                                                        {conta.nome}
                                                    </span>
                                                    <span className="block text-xs text-muted-foreground">
                                                        {conta.email ?? 'sem e-mail'}
                                                    </span>
                                                </>
                                            ) : null}
                                            {conta.unidades.length > 1 ? (
                                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                                    ↳ {unidade.nome} · {unidade.pessoas} pessoa
                                                    {unidade.pessoas === 1 ? '' : 's'}
                                                </span>
                                            ) : null}
                                        </td>
                                        <td className="px-4 py-2.5 text-sm">
                                            {i === 0 ? (conta.plano ?? '—') : null}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {i === 0 ? <Situacao conta={conta} /> : null}
                                        </td>
                                        <td className="num px-4 py-2.5 text-right text-sm">
                                            {i === 0
                                                ? `${conta.creditosUsados.toLocaleString('pt-BR')} / ${conta.creditos.toLocaleString('pt-BR')}`
                                                : null}
                                        </td>
                                        <td className="num px-4 py-2.5 text-sm text-muted-foreground">
                                            {i === 0 ? quando(conta.ultimaAtividadeEm) : null}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-2.5 text-right">
                                            {conta.daPlataforma ? (
                                                <span className="text-xs text-muted-foreground">
                                                    esta é a conta de casa
                                                </span>
                                            ) : (
                                                <>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8"
                                                        onClick={() => void entrar(unidade, 'leitura')}
                                                    >
                                                        <Eye className="size-4" />
                                                        Espiar
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="ml-1.5 h-8"
                                                        onClick={() =>
                                                            setConfirmando({ conta, unidade })
                                                        }
                                                    >
                                                        <LogIn className="size-4" />
                                                        Entrar
                                                    </Button>
                                                    {i === 0 ? (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="ml-1.5 h-8"
                                                            onClick={() => setAjustando(conta)}
                                                        >
                                                            <ShieldCheck className="size-4" />
                                                            Ajustar
                                                        </Button>
                                                    ) : null}
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}

                            {!carregando && filtradas.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={6}
                                        className="px-4 py-12 text-center text-sm text-muted-foreground"
                                    >
                                        Nenhuma conta encontrada.
                                    </td>
                                </tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>
            </div>

            {/*
              * Entrar com poder de gravar pede confirmação; espiar, não.
              *
              * A diferença entre os dois é o que o DESIGN.md manda marcar: o ato
              * que escreve em nome de outra pessoa não acontece por clique de
              * passagem.
              */}
            <ConfirmDialog
                open={confirmando !== null}
                onOpenChange={(v) => !v && setConfirmando(null)}
                title="Entrar na conta do cliente?"
                description={
                    confirmando
                        ? `Você vai abrir ${confirmando.conta.nome} — ${confirmando.unidade.nome} com poder de gravar, por 1 hora. Tudo o que você fizer fica no registro de acesso, com o seu nome.`
                        : ''
                }
                confirmLabel="Entrar"
                onConfirm={() => {
                    if (confirmando) void entrar(confirmando.unidade, 'total')
                    setConfirmando(null)
                }}
            />

            {ajustando ? (
                <Ajustes conta={ajustando} onFechar={() => setAjustando(null)} onFeito={carregar} />
            ) : null}
        </>
    )
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
    return (
        <th
            className={cn(
                'px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                className
            )}
        >
            {children}
        </th>
    )
}

function Resumo({
    rotulo,
    valor,
    alerta = false,
}: {
    rotulo: string
    valor: number
    alerta?: boolean
}) {
    return (
        <div className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {rotulo}
            </p>
            <p
                className={cn(
                    'num mt-1 text-h2',
                    alerta ? 'text-warning-subtle-foreground' : 'text-foreground'
                )}
            >
                {valor}
            </p>
        </div>
    )
}

/**
 * Os três ajustes que o suporte precisa, e o motivo que todos exigem.
 *
 * Segredo não entra aqui — chave de API e token de webhook não passam por
 * formulário de navegador (decisão de 2026-10-24, em `lib/platform-credentials.ts`).
 * Plano também não: quem cobra é o Asaas, e trocar o plano só no nosso banco
 * desencontraria os dois.
 */
function Ajustes({
    conta,
    onFechar,
    onFeito,
}: {
    conta: Conta
    onFechar: () => void
    onFeito: () => void
}) {
    const [motivo, setMotivo] = useState('')
    const [dias, setDias] = useState('7')
    const [creditos, setCreditos] = useState('1000')
    const [enviando, setEnviando] = useState(false)

    const aplicar = async (ajuste: Record<string, unknown>) => {
        if (motivo.trim().length < 4) {
            toast.error('Escreva o motivo do ajuste')
            return
        }
        setEnviando(true)
        try {
            const res = await fetch('/api/plataforma/ajustes', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId: conta.id, ajuste, motivo }),
            })
            const dados = await res.json().catch(() => null)
            if (!res.ok) throw new Error(dados?.error ?? 'Não foi possível aplicar')
            toast.success(dados?.descricao ?? 'Ajuste aplicado')
            onFeito()
            onFechar()
        } catch (erro) {
            toast.error(erro instanceof Error ? erro.message : 'Não foi possível aplicar')
        } finally {
            setEnviando(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4">
            <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl">
                <h2 className="text-h3">Ajustar {conta.nome}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Todo ajuste entra no registro de acesso, com o motivo.
                </p>

                <div className="mt-5 space-y-2">
                    <label htmlFor="motivo" className="text-sm font-medium">
                        Motivo
                    </label>
                    <Input
                        id="motivo"
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Ex: pagamento confirmado por comprovante, webhook não chegou"
                    />
                </div>

                <div className="mt-5 space-y-3 border-t border-border pt-5">
                    <div className="flex items-end gap-3">
                        <div className="w-24 space-y-1.5">
                            <label htmlFor="dias" className="text-xs font-medium">
                                Dias
                            </label>
                            <Input
                                id="dias"
                                value={dias}
                                onChange={(e) => setDias(e.target.value)}
                                inputMode="numeric"
                            />
                        </div>
                        <Button
                            variant="outline"
                            disabled={enviando}
                            onClick={() => void aplicar({ tipo: 'avaliacao', dias: Number(dias) })}
                        >
                            <Gift className="size-4" />
                            Estender a avaliação
                        </Button>
                    </div>

                    <div className="flex items-end gap-3">
                        <div className="w-32 space-y-1.5">
                            <label htmlFor="creditos" className="text-xs font-medium">
                                Créditos
                            </label>
                            <Input
                                id="creditos"
                                value={creditos}
                                onChange={(e) => setCreditos(e.target.value)}
                                inputMode="numeric"
                            />
                        </div>
                        <Button
                            variant="outline"
                            disabled={enviando}
                            onClick={() =>
                                void aplicar({ tipo: 'creditos', quantidade: Number(creditos) })
                            }
                        >
                            <Gift className="size-4" />
                            Conceder
                        </Button>
                    </div>

                    {conta.cortada || conta.somenteLeituraDesde ? (
                        <Button
                            variant="outline"
                            disabled={enviando}
                            onClick={() => void aplicar({ tipo: 'destravar' })}
                        >
                            <Unlock className="size-4" />
                            Tirar o somente-leitura
                        </Button>
                    ) : null}
                </div>

                <div className="mt-6 flex justify-end">
                    <Button variant="outline" onClick={onFechar}>
                        Fechar
                    </Button>
                </div>
            </div>
        </div>
    )
}
