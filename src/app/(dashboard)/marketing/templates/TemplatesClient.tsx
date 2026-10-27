'use client'

import { useCallback, useState } from 'react'
import { FileText, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { FormField } from '@/components/shared/FormField'
import { RecordDialog } from '@/components/shared/RecordDialog'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { usePermissions } from '@/hooks/usePermissions'
import { useIndiceServidor } from '@/hooks/useIndiceServidor'

import type { DadosIniciais, TemplateItem } from './dados'

const RECORTE_INTEIRO = 'workspace-inteiro'

/** Rótulo e cor por estado do template na Meta. */
const STATUS: Record<string, { label: string; cls: string }> = {
    APPROVED: { label: 'Aprovado', cls: 'text-success-foreground' },
    PENDING: { label: 'Em análise', cls: 'text-muted-foreground' },
    REJECTED: { label: 'Reprovado', cls: 'text-destructive' },
    PAUSED: { label: 'Pausado', cls: 'text-muted-foreground' },
    DISABLED: { label: 'Desativado', cls: 'text-destructive' },
}

const CATEGORIA: Record<string, string> = {
    MARKETING: 'Marketing',
    UTILITY: 'Utilidade',
    AUTHENTICATION: 'Autenticação',
}

export function TemplatesClient({ inicial }: { inicial: DadosIniciais }) {
    const { canEdit } = usePermissions()

    const buscar = useCallback(async () => {
        const res = await fetch('/api/marketing/templates')
        if (!res.ok) {
            toast.error('Não foi possível carregar os templates')
            return null
        }
        const data = (await res.json()) as {
            templates: Array<{
                id: string
                metaName: string
                language: string
                category: string
                status: string
                integrationId: string
                variaveis: { body: number; header: number }
                syncedAt: string
            }>
        }
        const itens: TemplateItem[] = data.templates.map((t) => ({
            id: t.id,
            metaName: t.metaName,
            language: t.language,
            category: t.category,
            status: t.status,
            integrationId: t.integrationId,
            bodyVars: t.variaveis.body,
            headerVars: t.variaveis.header,
            syncedAt: t.syncedAt,
        }))
        return { itens, total: itens.length, totalPages: 1 }
    }, [])

    const {
        itens: templates,
        carregando: loading,
        recarregar,
    } = useIndiceServidor<TemplateItem>({ inicial: inicial.pagina, recorte: RECORTE_INTEIRO, buscar })

    const linhas = inicial.linhas
    const [syncOpen, setSyncOpen] = useState(false)
    const [linhaId, setLinhaId] = useState<string>(linhas[0]?.integrationId ?? '')
    const [submitting, setSubmitting] = useState(false)

    async function sincronizar() {
        if (!linhaId) {
            toast.error('Escolha a linha oficial')
            return
        }
        setSubmitting(true)
        try {
            const res = await fetch('/api/marketing/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ integrationId: linhaId }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => null)
                throw new Error(e?.error ?? 'Falha ao sincronizar')
            }
            const { total } = (await res.json()) as { total: number }
            toast.success(`${total} template${total === 1 ? '' : 's'} sincronizado${total === 1 ? '' : 's'}`)
            setSyncOpen(false)
            void recarregar()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Falha ao sincronizar')
        } finally {
            setSubmitting(false)
        }
    }

    const columns: Column<TemplateItem>[] = [
        {
            id: 'metaName',
            header: 'Template',
            sortable: true,
            sortValue: (t) => t.metaName,
            cell: (t) => (
                <div className="flex flex-col">
                    <span className="font-mono text-sm text-foreground">{t.metaName}</span>
                    <span className="text-xs text-muted-foreground">{t.language}</span>
                </div>
            ),
        },
        {
            id: 'category',
            header: 'Categoria',
            sortable: true,
            sortValue: (t) => t.category,
            width: '10rem',
            cell: (t) => <span className="text-sm">{CATEGORIA[t.category] ?? t.category}</span>,
        },
        {
            id: 'vars',
            header: 'Variáveis',
            width: '8rem',
            cell: (t) => (
                <span className="num text-sm text-muted-foreground">
                    {t.bodyVars + t.headerVars}
                </span>
            ),
        },
        {
            id: 'status',
            header: 'Estado',
            sortable: true,
            sortValue: (t) => t.status,
            width: '9rem',
            cell: (t) => {
                const s = STATUS[t.status] ?? { label: t.status, cls: 'text-muted-foreground' }
                return <span className={`text-sm ${s.cls}`}>{s.label}</span>
            },
        },
    ]

    return (
        <>
            <IndexFrame
                title="Templates"
                primary={
                    canEdit && linhas.length > 0 ? (
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5"
                            onClick={() => setSyncOpen(true)}
                        >
                            <RefreshCw className="size-3.5" /> Sincronizar
                        </Button>
                    ) : null
                }
            >
                <DataTable
                    frame
                    columns={columns}
                    rows={templates}
                    getRowId={(t) => t.id}
                    loading={loading}
                    empty={
                        <EmptyState
                            variant="inline"
                            icon={FileText}
                            title={
                                linhas.length === 0
                                    ? 'Conecte um WhatsApp oficial'
                                    : 'Nenhum template sincronizado'
                            }
                            description={
                                linhas.length === 0
                                    ? 'Os templates vêm de uma linha de WhatsApp oficial (Cloud API). Conecte uma em Agentes para usar campanhas.'
                                    : 'Os modelos são criados e aprovados no painel da Meta. Sincronize para trazê-los para cá.'
                            }
                            action={
                                canEdit && linhas.length > 0 ? (
                                    <Button onClick={() => setSyncOpen(true)}>
                                        <RefreshCw /> Sincronizar
                                    </Button>
                                ) : null
                            }
                        />
                    }
                />
            </IndexFrame>

            <RecordDialog
                open={syncOpen}
                onOpenChange={setSyncOpen}
                title="Sincronizar templates"
                description="Traz os modelos aprovados da linha oficial escolhida. Criar e aprovar modelos é feito no painel da Meta."
                submitLabel="Sincronizar"
                hideAgain
                onSubmit={sincronizar}
                submitting={submitting}
            >
                <FormField label="Linha oficial" htmlFor="sync-linha" required className="col-span-2">
                    <Select value={linhaId} onValueChange={setLinhaId}>
                        <SelectTrigger id="sync-linha">
                            <SelectValue placeholder="Escolha a linha" />
                        </SelectTrigger>
                        <SelectContent>
                            {linhas.map((l) => (
                                <SelectItem key={l.integrationId} value={l.integrationId}>
                                    {l.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>
            </RecordDialog>
        </>
    )
}
