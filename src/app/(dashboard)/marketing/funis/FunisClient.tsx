'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { GitBranch, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { FormField } from '@/components/shared/FormField'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { RecordDialog } from '@/components/shared/RecordDialog'
import { RowActionItem, RowActions } from '@/components/shared/RowActions'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { usePermissions } from '@/hooks/usePermissions'
import { useIndiceServidor } from '@/hooks/useIndiceServidor'
import { frasedoGatilho, SITUACAO_DO_FUNIL } from '@/lib/funil/apresentacao'
import { GALERIA_DE_FUNIS } from '@/lib/funil/galeria'

import type { DadosIniciais, FunilItem } from './dados'

const RECORTE_INTEIRO = 'workspace-inteiro'

export function FunisClient({ inicial }: { inicial: DadosIniciais }) {
    const { canEdit } = usePermissions()
    const router = useRouter()

    const buscar = useCallback(async () => {
        const res = await fetch('/api/marketing/funis')
        if (!res.ok) {
            toast.error('Não foi possível carregar os funis')
            return null
        }
        const itens = (await res.json()) as FunilItem[]
        return { itens, total: itens.length, totalPages: 1 }
    }, [])

    const {
        itens: funis,
        carregando: loading,
        recarregar,
    } = useIndiceServidor<FunilItem>({ inicial, recorte: RECORTE_INTEIRO, buscar })

    const [busca, setBusca] = useState('')
    const [novoAberto, setNovoAberto] = useState(false)
    const [nome, setNome] = useState('')
    const [modelo, setModelo] = useState<string>('vazio')
    const [erro, setErro] = useState<string | undefined>()
    const [criando, setCriando] = useState(false)
    const [apagando, setApagando] = useState<FunilItem | null>(null)

    const visiveis = funis.filter(
        (f) =>
            busca.trim() === '' || f.name.toLowerCase().includes(busca.trim().toLowerCase())
    )

    async function criar() {
        if (!nome.trim()) {
            setErro('Dê um nome ao funil')
            return
        }
        setCriando(true)
        try {
            const partida = GALERIA_DE_FUNIS.find((g) => g.id === modelo)
            const res = await fetch('/api/marketing/funis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: nome.trim(),
                    description: partida?.descricao ?? null,
                    trigger: partida?.trigger ?? { tipo: 'contato_criado' },
                    maxAtivos: partida?.maxAtivos ?? null,
                    passos: partida?.passos ?? [],
                }),
            })
            const corpo = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
            if (!res.ok) {
                setErro(corpo.error ?? 'Não foi possível criar o funil')
                return
            }
            setNovoAberto(false)
            // Direto para o canvas: criar um funil sem desenhá-lo não tem
            // utilidade, e voltar para a lista obrigaria a um clique a mais
            // sempre.
            router.push(`/marketing/funis/${corpo.id}`)
        } finally {
            setCriando(false)
        }
    }

    async function apagar() {
        if (!apagando) return
        const res = await fetch(`/api/marketing/funis/${apagando.id}`, { method: 'DELETE' })
        if (!res.ok) {
            const corpo = (await res.json().catch(() => ({}))) as { error?: string }
            toast.error(corpo.error ?? 'Não foi possível apagar')
            return
        }
        setApagando(null)
        await recarregar()
    }

    const colunas: Column<FunilItem>[] = [
        {
            id: 'name',
            header: 'Funil',
            cell: (f) => (
                <div className="min-w-0">
                    <div className="truncate font-medium">{f.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                        {frasedoGatilho(f.trigger)} · {f.passos} passo{f.passos === 1 ? '' : 's'}
                    </div>
                </div>
            ),
        },
        {
            id: 'status',
            header: 'Situação',
            width: '9rem',
            cell: (f) => <StatusBadge value={f.status} map={SITUACAO_DO_FUNIL} />,
        },
        {
            id: 'ativos',
            header: 'Dentro',
            width: '7rem',
            cell: (f) => (
                <span className="text-sm">
                    {f.ativos}
                    {f.maxAtivos !== null && (
                        <span className="text-muted-foreground"> / {f.maxAtivos}</span>
                    )}
                </span>
            ),
        },
        {
            id: 'desfechos',
            header: 'Terminaram · pararam',
            width: '13rem',
            /**
             * Os dois juntos e separados por "·", não somados.
             *
             * "Parou porque a recepção assumiu" é o funil funcionando; "terminou"
             * é a sequência entregue. Um número só esconderia a pergunta que a
             * dona da clínica faz primeiro.
             */
            cell: (f) => (
                <span className="text-sm text-muted-foreground">
                    {f.concluidos} · {f.parados}
                    {f.falhos > 0 && (
                        <span className="text-destructive"> · {f.falhos} com falha</span>
                    )}
                </span>
            ),
        },
    ]

    return (
        <>
            <IndexFrame
                title="Funis"
                search={busca}
                onSearchChange={setBusca}
                primary={
                    canEdit ? (
                        <Button onClick={() => { setNome(''); setModelo('vazio'); setErro(undefined); setNovoAberto(true) }}>
                            <Plus /> Novo funil
                        </Button>
                    ) : null
                }
            >
                <DataTable
                    columns={colunas}
                    rows={visiveis}
                    getRowId={(f) => f.id}
                    loading={loading}
                    frame
                    onRowClick={(f) => router.push(`/marketing/funis/${f.id}`)}
                    rowActions={
                        canEdit
                            ? (f) => (
                                  <RowActions label={`Ações do funil ${f.name}`}>
                                      <RowActionItem
                                          icon={Pencil}
                                          onClick={() => router.push(`/marketing/funis/${f.id}`)}
                                      >
                                          Abrir o desenho
                                      </RowActionItem>
                                      <RowActionItem
                                          icon={Trash2}
                                          destructive
                                          onClick={() => setApagando(f)}
                                      >
                                          Apagar
                                      </RowActionItem>
                                  </RowActions>
                              )
                            : undefined
                    }
                    empty={
                        <EmptyState
                            variant="inline"
                            icon={GitBranch}
                            title="Nenhum funil ainda"
                            description="Um funil manda a sequência sozinho — e para por conta própria quando alguém da equipe assume a conversa."
                            action={
                                canEdit ? (
                                    <Button onClick={() => setNovoAberto(true)}>
                                        <Plus /> Novo funil
                                    </Button>
                                ) : null
                            }
                        />
                    }
                />
            </IndexFrame>

            <RecordDialog
                open={novoAberto}
                onOpenChange={setNovoAberto}
                title="Novo funil"
                description="Nasce como rascunho. Nada é enviado até você publicar."
                submitLabel="Criar e desenhar"
                onSubmit={criar}
                submitting={criando}
            >
                <FormField
                    label="Nome"
                    htmlFor="funil-nome"
                    required
                    error={erro}
                    className="col-span-2"
                >
                    <Input
                        id="funil-nome"
                        value={nome}
                        onChange={(e) => {
                            setNome(e.target.value)
                            if (erro) setErro(undefined)
                        }}
                        placeholder="Retorno de seis meses"
                        autoFocus
                    />
                </FormField>

                <FormField
                    label="Começar de"
                    htmlFor="funil-modelo"
                    className="col-span-2"
                    hint="Um ponto de partida já desenhado, que você ajusta depois. Tudo nasce como rascunho."
                >
                    <select
                        id="funil-modelo"
                        value={modelo}
                        onChange={(e) => setModelo(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    >
                        <option value="vazio">Começar do zero</option>
                        {GALERIA_DE_FUNIS.map((g) => (
                            <option key={g.id} value={g.id}>
                                {g.nome}
                            </option>
                        ))}
                    </select>
                </FormField>
            </RecordDialog>

            <ConfirmDialog
                open={apagando !== null}
                onOpenChange={(aberto) => !aberto && setApagando(null)}
                title={`Apagar "${apagando?.name ?? ''}"?`}
                description="O desenho e o histórico de passagens vão com ele. Funil com gente dentro não é apagado — despublique primeiro."
                confirmLabel="Apagar funil"
                destructive
                onConfirm={apagar}
            />
        </>
    )
}
