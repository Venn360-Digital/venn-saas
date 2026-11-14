'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FileText, Mail, MessageCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@venn/ui/select'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { FormField } from '@/components/shared/FormField'
import { RecordDialog } from '@/components/shared/RecordDialog'
import { TabsFrame, type FrameTab } from '@/components/shared/TabsFrame'
import { RowActionItem, RowActions } from '@/components/shared/RowActions'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EditorDeEmail, type TemplateDeEmail } from './EditorDeEmail'
import { usePermissions } from '@/hooks/usePermissions'
import { useIndiceServidor } from '@/hooks/useIndiceServidor'

import type { DadosIniciais, TemplateItem } from './dados'

const RECORTE_INTEIRO = 'workspace-inteiro'

type GuiaDeTemplate = 'whatsapp' | 'email'

/**
 * Duas guias para dois objetos que só parecem o mesmo.
 *
 * O da esquerda é **espelho** do que a Meta aprovou e só se sincroniza; o da
 * direita é escrito aqui e não depende de aprovação de ninguém. Os verbos são
 * diferentes — "Sincronizar" × "Novo modelo" —, e é por isso que a ação
 * primária troca com a guia.
 */
const GUIAS: FrameTab[] = [
    { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
    { id: 'email', label: 'E-mail', icon: Mail },
]

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
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()

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


    /**
     * A guia aberta vive no `?tab=`, nao numa copia em `useState`.
     *
     * Semear estado da URL uma vez faz o link fundo funcionar so na primeira
     * vez: clicar em outro `?tab=` ja estando na pagina e navegacao de cliente
     * e nao remonta o componente, entao o estado guardaria a guia velha. E
     * derivar da URL torna a troca compartilhavel.
     */
    const pedida = searchParams.get('tab')
    const guiaAtiva: GuiaDeTemplate =
        pedida === 'email' || pedida === 'whatsapp' ? pedida : 'whatsapp'
    const trocarGuia = (proxima: string) =>
        router.replace(`${pathname}?tab=${proxima}`, { scroll: false })

    // ───────────────────── A guia de e-mail ─────────────────────

    /**
     * `null` = ainda não buscou. É daí que sai o "carregando", em vez de um
     * segundo estado booleano — que, posto no começo do efeito, era `setState`
     * síncrono dentro de efeito e o ESLint do projeto reprova (renderização em
     * cascata).
     *
     * E tem um ganho: na releitura depois de salvar, a lista anterior continua
     * na tela em vez de piscar vazia. "Carregar não apaga a tela" é regra do
     * DESIGN.md.
     */
    const [modelos, setModelos] = useState<TemplateDeEmail[] | null>(null)
    const [editorAberto, setEditorAberto] = useState(false)
    const [editandoModelo, setEditandoModelo] = useState<TemplateDeEmail | null>(null)
    const [excluindo, setExcluindo] = useState<TemplateDeEmail | null>(null)

    const carregarModelos = useCallback(async () => {
        try {
            const res = await fetch('/api/marketing/email-templates')
            setModelos(res.ok ? ((await res.json()) as TemplateDeEmail[]) : [])
        } catch {
            toast.error('Não foi possível carregar os modelos')
            setModelos([])
        }
    }, [])

    /**
     * Carrega ao abrir a guia, e só então.
     *
     * Buscar na montagem traria os modelos para quem nunca vai sair da guia do
     * WhatsApp — uma consulta por visita, para nada.
     *
     * **Em efeito, não no render.** A primeira versão chamava `carregarModelos`
     * direto no corpo do componente, guardando numa flag qual guia já tinha
     * carregado. O tipo passava e a tabela vinha **vazia**: buscar é efeito
     * colateral, e efeito colateral no render o React descarta. Foi o navegador
     * que acusou — a API respondia com os dois modelos e a tela não mostrava
     * nenhum.
     */
    useEffect(() => {
        if (guiaAtiva !== 'email') return
        /**
         * A guarda de cancelamento não é cerimônia: trocar de guia e voltar
         * rápido deixa duas buscas no ar, e a que chegar por último vence —
         * que pode ser a mais velha. Sem a guarda, a tela mostraria uma lista
         * desatualizada sem nenhum sinal de que isso aconteceu.
         */
        let vivo = true
        void (async () => {
            try {
                const res = await fetch('/api/marketing/email-templates')
                const dados = res.ok ? ((await res.json()) as TemplateDeEmail[]) : []
                if (vivo) setModelos(dados)
            } catch {
                if (!vivo) return
                toast.error('Não foi possível carregar os modelos')
                setModelos([])
            }
        })()
        return () => {
            vivo = false
        }
    }, [guiaAtiva])

    function abrirNovoModelo() {
        setEditandoModelo(null)
        setEditorAberto(true)
    }

    function abrirEdicaoDeModelo(m: TemplateDeEmail) {
        setEditandoModelo(m)
        setEditorAberto(true)
    }

    async function excluirModelo(id: string) {
        const res = await fetch(`/api/marketing/email-templates/${id}`, { method: 'DELETE' })
        if (!res.ok) {
            const e = (await res.json().catch(() => null)) as { error?: string } | null
            // O 409 vem com a razão de verdade: o modelo está em uso por N
            // campanhas. Trocá-la por "não foi possível" esconderia o que a
            // pessoa precisa saber para decidir o que fazer.
            toast.error(e?.error ?? 'Não foi possível excluir o modelo')
            return
        }
        toast.success('Modelo excluído')
        await carregarModelos()
    }

    const colunasDeModelo: Column<TemplateDeEmail>[] = [
        {
            id: 'name',
            header: 'Modelo',
            sortable: true,
            sortValue: (m) => m.name,
            cell: (m) => (
                <div className="flex flex-col">
                    <span className="text-sm text-foreground">{m.name}</span>
                    {m.subject ? (
                        <span className="text-xs text-muted-foreground">{m.subject}</span>
                    ) : null}
                </div>
            ),
        },
        {
            id: 'blocos',
            header: 'Blocos',
            width: '7rem',
            className: 'text-right',
            cell: (m) => <span className="num text-sm text-muted-foreground">{m.blocks.length}</span>,
        },
    ]

    return (
        <>
            <TabsFrame
                title="Templates"
                fill
                tabs={GUIAS}
                active={guiaAtiva}
                onChange={trocarGuia}
                primary={
                    !canEdit ? null : guiaAtiva === 'email' ? (
                        <Button size="sm" className="h-8 gap-1.5" onClick={abrirNovoModelo}>
                            <Plus className="size-3.5" /> Novo modelo
                        </Button>
                    ) : linhas.length > 0 ? (
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
                {guiaAtiva === 'email' ? (
                    <DataTable
                        frame
                        columns={colunasDeModelo}
                        rows={modelos ?? []}
                        getRowId={(m) => m.id}
                        loading={modelos === null}
                        onRowClick={canEdit ? (m) => abrirEdicaoDeModelo(m) : undefined}
                        rowActions={
                            canEdit
                                ? (m) => (
                                      <RowActions label={`Ações do modelo ${m.name}`}>
                                          <RowActionItem
                                              icon={Pencil}
                                              onClick={() => abrirEdicaoDeModelo(m)}
                                          >
                                              Editar
                                          </RowActionItem>
                                          <RowActionItem
                                              icon={Trash2}
                                              destructive
                                              onClick={() => setExcluindo(m)}
                                          >
                                              Excluir
                                          </RowActionItem>
                                      </RowActions>
                                  )
                                : undefined
                        }
                        empty={
                            <EmptyState
                                variant="inline"
                                icon={Mail}
                                title="Nenhum modelo de e-mail"
                                description="O conteúdo é montado em blocos — título, texto, imagem, botão. Diferente dos modelos de WhatsApp, estes não dependem de aprovação de ninguém."
                                action={
                                    canEdit ? (
                                        <Button onClick={abrirNovoModelo}>
                                            <Plus /> Novo modelo
                                        </Button>
                                    ) : null
                                }
                            />
                        }
                    />
                ) : (
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
                )}
            </TabsFrame>

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

            <EditorDeEmail
                aberto={editorAberto}
                onOpenChange={setEditorAberto}
                editando={editandoModelo}
                onSalvo={carregarModelos}
            />

            <ConfirmDialog
                open={excluindo !== null}
                onOpenChange={(aberto) => !aberto && setExcluindo(null)}
                title="Excluir modelo"
                description={`O modelo "${excluindo?.name ?? ''}" é removido. Campanhas já disparadas com ele não são afetadas — o conteúdo que saiu fica registrado nelas.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={async () => {
                    if (excluindo) await excluirModelo(excluindo.id)
                }}
            />
        </>
    )
}
