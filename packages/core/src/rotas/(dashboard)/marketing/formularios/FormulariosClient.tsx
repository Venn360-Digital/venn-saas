'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { ConfirmDialog } from '@venn/core/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@venn/core/components/shared/DataTable'
import { EmptyState } from '@venn/core/components/shared/EmptyState'
import { FormField } from '@venn/core/components/shared/FormField'
import { IndexFrame } from '@venn/core/components/shared/IndexFrame'
import { Pagination } from '@venn/core/components/shared/Pagination'
import { RecordDialog } from '@venn/core/components/shared/RecordDialog'
import { RowActionItem, RowActions } from '@venn/core/components/shared/RowActions'
import { StatusBadge, FORMULARIO_STATUS } from '@venn/core/components/shared/StatusBadge'
import { usePermissions } from '@venn/core/hooks/usePermissions'
import { useIndiceServidor } from '@venn/core/hooks/useIndiceServidor'

import type { DadosIniciais, FormularioItem } from './dados'

const RECORTE_INTEIRO = 'workspace-inteiro'

/**
 * O índice dos formulários de captura.
 *
 * Criar é só o nome: o resto é do editor, que é tela própria (como o funil de
 * marketing) — o desenho de um formulário não cabe num diálogo, e a prévia
 * precisa de largura.
 */
export function FormulariosClient({ inicial }: { inicial: DadosIniciais }) {
    const router = useRouter()
    const { canEdit } = usePermissions()

    const buscar = useCallback(async () => {
        const res = await fetch('/api/marketing/formularios')
        if (!res.ok) {
            toast.error('Não foi possível carregar os formulários')
            return null
        }
        const itens = (await res.json()) as FormularioItem[]
        return { itens, total: itens.length, totalPages: 1 }
    }, [])

    const { itens, carregando, recarregar } = useIndiceServidor<FormularioItem>({
        inicial,
        recorte: RECORTE_INTEIRO,
        buscar,
    })

    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(20)
    const [novoAberto, setNovoAberto] = useState(false)
    const [nome, setNome] = useState('')
    const [erro, setErro] = useState<string | null>(null)
    const [criando, setCriando] = useState(false)
    const [excluindo, setExcluindo] = useState<FormularioItem | null>(null)

    const criar = async () => {
        const name = nome.trim()
        if (!name) {
            setErro('Dê um nome ao formulário.')
            return
        }
        setCriando(true)
        try {
            const res = await fetch('/api/marketing/formularios', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            })
            const dados = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
            if (!res.ok || !dados.id) {
                setErro(dados.error || 'Não foi possível criar o formulário')
                return
            }
            setNovoAberto(false)
            // Nasce em rascunho, com os campos de todo lead; quem cria vai
            // ajustar o desenho — então a tela abre o editor.
            router.push(`/marketing/formularios/${dados.id}`)
        } finally {
            setCriando(false)
        }
    }

    const excluir = async () => {
        if (!excluindo) return
        const res = await fetch(`/api/marketing/formularios/${excluindo.id}`, { method: 'DELETE' })
        if (!res.ok) {
            toast.error('Não foi possível excluir o formulário')
            return
        }
        toast.success('Formulário excluído')
        setExcluindo(null)
        await recarregar()
    }

    const needle = search.trim().toLowerCase()
    const filtrados = needle ? itens.filter((f) => f.name.toLowerCase().includes(needle)) : itens
    const totalPages = Math.max(1, Math.ceil(filtrados.length / pageSize))
    const paginaAtual = Math.min(page, totalPages)
    const visiveis = filtrados.slice((paginaAtual - 1) * pageSize, paginaAtual * pageSize)

    const colunas: Column<FormularioItem>[] = [
        {
            id: 'name',
            header: 'Formulário',
            sortable: true,
            sortValue: (f) => f.name,
            cell: (f) => <span className="text-sm text-foreground">{f.name}</span>,
        },
        {
            id: 'status',
            header: 'Situação',
            sortable: true,
            sortValue: (f) => f.status,
            width: '8rem',
            cell: (f) => <StatusBadge value={f.status} map={FORMULARIO_STATUS} />,
        },
        {
            id: 'envios',
            header: 'Envios',
            sortable: true,
            sortValue: (f) => f.envios,
            width: '7rem',
            className: 'text-right',
            cell: (f) => <span className="num text-sm">{f.envios}</span>,
        },
        {
            id: 'updatedAt',
            header: 'Atualizado',
            sortable: true,
            sortValue: (f) => f.updatedAt,
            width: '10rem',
            hideBelow: 'md',
            cell: (f) => (
                <span className="num text-sm text-foreground">
                    {new Date(f.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
            ),
        },
    ]

    return (
        <>
            <IndexFrame
                title="Formulários"
                search={search}
                onSearchChange={(v) => {
                    setSearch(v)
                    setPage(1)
                }}
                searchLabel="Buscar formulário"
                primary={
                    canEdit ? (
                        <Button size="sm" className="h-8 gap-1.5" onClick={() => { setNome(''); setErro(null); setNovoAberto(true) }}>
                            <Plus className="size-3.5" /> Novo formulário
                        </Button>
                    ) : null
                }
            >
                <DataTable
                    frame
                    columns={colunas}
                    rows={visiveis}
                    getRowId={(f) => f.id}
                    loading={carregando}
                    onRowClick={canEdit ? (f) => router.push(`/marketing/formularios/${f.id}`) : undefined}
                    footer={
                        <Pagination
                            page={paginaAtual}
                            totalPages={totalPages}
                            total={filtrados.length}
                            limit={pageSize}
                            onPageChange={setPage}
                            onLimitChange={(limit) => {
                                setPageSize(limit)
                                setPage(1)
                            }}
                        />
                    }
                    rowActions={
                        canEdit
                            ? (f) => (
                                  <RowActions label={`Ações do formulário ${f.name}`}>
                                      <RowActionItem icon={Pencil} onClick={() => router.push(`/marketing/formularios/${f.id}`)}>
                                          Abrir o editor
                                      </RowActionItem>
                                      <RowActionItem icon={Trash2} destructive onClick={() => setExcluindo(f)}>
                                          Excluir
                                      </RowActionItem>
                                  </RowActions>
                              )
                            : undefined
                    }
                    empty={
                        <EmptyState
                            variant="inline"
                            icon={ClipboardList}
                            title="Nenhum formulário ainda"
                            description="Um formulário no site transforma visitante em lead: a resposta vira ficha e negócio, sem ninguém digitar."
                            action={
                                canEdit ? (
                                    <Button size="sm" className="gap-1.5" onClick={() => { setNome(''); setErro(null); setNovoAberto(true) }}>
                                        <Plus className="size-3.5" /> Criar formulário
                                    </Button>
                                ) : undefined
                            }
                        />
                    }
                />
            </IndexFrame>

            <RecordDialog
                open={novoAberto}
                onOpenChange={setNovoAberto}
                title="Novo formulário"
                description="Nasce com nome, WhatsApp e e-mail. O desenho se ajusta no editor, que abre em seguida."
                submitLabel="Criar formulário"
                hideAgain
                onSubmit={criar}
                submitting={criando}
            >
                <FormField label="Nome" htmlFor="form-nome" required error={erro ?? undefined} className="col-span-2">
                    <Input
                        id="form-nome"
                        value={nome}
                        onChange={(e) => {
                            setNome(e.target.value)
                            if (erro) setErro(null)
                        }}
                        placeholder="Orçamento pelo site"
                        aria-invalid={erro ? true : undefined}
                        autoFocus
                    />
                </FormField>
            </RecordDialog>

            <ConfirmDialog
                open={excluindo !== null}
                onOpenChange={(aberto) => { if (!aberto) setExcluindo(null) }}
                title="Excluir formulário"
                description={`«${excluindo?.name ?? ''}» sai do ar e os envios registrados nele são apagados. As fichas e os negócios que nasceram dele ficam.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={excluir}
            />
        </>
    )
}
