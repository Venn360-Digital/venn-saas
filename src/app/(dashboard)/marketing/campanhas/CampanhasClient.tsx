'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Megaphone, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@venn/ui/select'
import { DataTable, type Column } from '@venn/core/components/shared/DataTable'
import { EmptyState } from '@venn/core/components/shared/EmptyState'
import { FormField } from '@venn/core/components/shared/FormField'
import { RecordDialog } from '@venn/core/components/shared/RecordDialog'
import { IndexFrame } from '@venn/core/components/shared/IndexFrame'
import { usePermissions } from '@venn/core/hooks/usePermissions'
import { useIndiceServidor } from '@venn/core/hooks/useIndiceServidor'

import {
    CANAIS_DE_CAMPANHA,
    NOME_DO_CANAL,
    type CanalDeCampanha,
} from '@venn/core/lib/marketing/apresentacao'

import { type CampanhaItem, type DadosIniciais, ORDEM_STATUS, STATUS_CAMPANHA } from './dados'

const RECORTE_INTEIRO = 'workspace-inteiro'

interface ListaOpcao {
    id: string
    name: string
    channel?: string
    memberCount: number
}
interface LinhaOpcao {
    integrationId: string
    label: string
}
interface TemplateOpcao {
    id: string
    metaName: string
    integrationId: string
    status: string
    variaveis: { body: number; header: number }
}

interface RemetenteOpcao {
    id: string
    from: string
    status: string
    domain: string
}
interface ModeloDeEmailOpcao {
    id: string
    name: string
    subject: string | null
}

const EMPTY = {
    name: '',
    labels: '',
    canal: 'whatsapp' as CanalDeCampanha,
    // WhatsApp
    integrationId: '',
    templateId: '',
    // E-mail
    senderId: '',
    emailTemplateId: '',
    subject: '',
    /**
     * O ritmo padrao muda com o canal, e nao e preciosismo.
     *
     * No WhatsApp 30/min e conservador para o tier da WABA. No e-mail o teto e
     * a cota diaria do SES e a reputacao de um dominio que costuma ser novo —
     * uma rajada de dois mil e-mails num dominio sem historico e a forma mais
     * rapida de ir para a caixa de spam. Comecar devagar e o que aquece.
     */
    throttle: '30',
}

/** O ritmo inicial sugerido por canal. */
const RITMO_PADRAO: Record<CanalDeCampanha, string> = {
    whatsapp: '30',
    email: '20',
}

export function CampanhasClient({ inicial }: { inicial: DadosIniciais }) {
    const { canEdit } = usePermissions()
    const router = useRouter()

    const buscar = useCallback(async () => {
        const res = await fetch('/api/marketing/campaigns')
        if (!res.ok) {
            toast.error('Não foi possível carregar as campanhas')
            return null
        }
        const itens = (await res.json()) as CampanhaItem[]
        return { itens, total: itens.length, totalPages: 1 }
    }, [])

    const { itens: campanhas, carregando: loading } = useIndiceServidor<CampanhaItem>({
        inicial,
        recorte: RECORTE_INTEIRO,
        buscar,
    })

    const [statusFiltro, setStatusFiltro] = useState<string>('all')

    const [open, setOpen] = useState(false)
    const [form, setForm] = useState(EMPTY)
    const [listIds, setListIds] = useState<string[]>([])
    const [bodyVars, setBodyVars] = useState<string[]>([])
    const [headerVars, setHeaderVars] = useState<string[]>([])
    const [submitting, setSubmitting] = useState(false)

    const [listas, setListas] = useState<ListaOpcao[]>([])
    const [linhas, setLinhas] = useState<LinhaOpcao[]>([])
    const [templates, setTemplates] = useState<TemplateOpcao[]>([])
    const [remetentes, setRemetentes] = useState<RemetenteOpcao[]>([])
    const [modelosDeEmail, setModelosDeEmail] = useState<ModeloDeEmailOpcao[]>([])

    useEffect(() => {
        if (!open) return
        fetch('/api/marketing/lists')
            .then((r) => (r.ok ? r.json() : []))
            .then((d: ListaOpcao[]) => setListas(Array.isArray(d) ? d : []))
            .catch(() => {})
        fetch('/api/marketing/templates')
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { linhas?: LinhaOpcao[]; templates?: TemplateOpcao[] } | null) => {
                setLinhas(d?.linhas ?? [])
                setTemplates(d?.templates ?? [])
            })
            .catch(() => {})
        /**
         * As opcoes dos DOIS canais sao carregadas junto, e nao so as do canal
         * escolhido: trocar de canal no meio do formulario nao pode render uma
         * espera, e sao duas listas curtas.
         */
        fetch('/api/marketing/remetentes')
            .then((r) => (r.ok ? r.json() : []))
            .then((d: RemetenteOpcao[]) => setRemetentes(Array.isArray(d) ? d : []))
            .catch(() => {})
        fetch('/api/marketing/email-templates')
            .then((r) => (r.ok ? r.json() : []))
            .then((d: ModeloDeEmailOpcao[]) => setModelosDeEmail(Array.isArray(d) ? d : []))
            .catch(() => {})
    }, [open])

    function openNew() {
        setForm(EMPTY)
        setListIds([])
        setBodyVars([])
        setHeaderVars([])
        setOpen(true)
    }

    // Templates aprovados da linha escolhida.
    const templatesDaLinha = useMemo(
        () => templates.filter((t) => t.integrationId === form.integrationId && t.status === 'APPROVED'),
        [templates, form.integrationId],
    )
    const templateSel = templatesDaLinha.find((t) => t.id === form.templateId) ?? null

    /**
     * Só remetente `verified` entra na lista.
     *
     * Oferecer um pendente deixaria a pessoa montar a campanha inteira para o
     * servidor recusar no fim — e a recusa certa ("publique os três registros
     * de DNS") chegaria tarde demais para ser útil.
     */
    const remetentesVerificados = useMemo(
        () => remetentes.filter((r) => r.status === 'verified'),
        [remetentes]
    )
    const modeloSel = modelosDeEmail.find((m) => m.id === form.emailTemplateId) ?? null

    // Os arrays de variáveis não são redimensionados ao trocar de template de
    // propósito: a tela lê por índice até o número de variáveis do template, e
    // `montarComponentes` corta o resto no envio — valor sobrando é ignorado nos
    // dois lados, então não há estado a sincronizar aqui.

    /**
     * Só as listas do canal escolhido.
     *
     * Uma lista de WhatsApp numa campanha de e-mail resolveria em zero
     * destinatários — os membros dela foram selecionados por terem telefone. A
     * recusa aconteceria no disparo, depois de a pessoa já ter montado tudo.
     */
    const listasDoCanal = useMemo(
        () => listas.filter((l) => (l.channel ?? 'whatsapp') === form.canal),
        [listas, form.canal]
    )

    function toggleLista(id: string) {
        setListIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    }

    async function criar() {
        const porEmail = form.canal === 'email'

        if (!form.name.trim()) { toast.error('Dê um nome à campanha'); return }
        if (listIds.length === 0) { toast.error('Escolha ao menos uma lista'); return }
        if (porEmail) {
            if (!form.senderId) { toast.error('Escolha o remetente'); return }
            if (!form.emailTemplateId) { toast.error('Escolha o modelo de e-mail'); return }
        } else {
            if (!form.integrationId) { toast.error('Escolha a linha oficial'); return }
            if (!form.templateId) { toast.error('Escolha um template aprovado'); return }
        }

        setSubmitting(true)
        try {
            const res = await fetch('/api/marketing/campaigns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: form.name.trim(),
                    labels: form.labels
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    channel: form.canal,
                    listIds,
                    throttlePerMin: Number(form.throttle) || 30,
                    ...(porEmail
                        ? {
                              senderId: form.senderId,
                              emailTemplateId: form.emailTemplateId,
                              // Vazio vira ausente: o servidor cai no assunto do
                              // modelo, e mandar '' o faria recusar por assunto
                              // em branco quando havia um no modelo.
                              subject: form.subject.trim() || undefined,
                          }
                        : {
                              integrationId: form.integrationId,
                              templateId: form.templateId,
                              variables: { body: bodyVars, header: headerVars },
                          }),
                }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => null)
                throw new Error(e?.error ?? 'Não foi possível criar a campanha')
            }
            const { id } = (await res.json()) as { id: string }
            toast.success('Campanha criada em rascunho')
            setOpen(false)
            router.push(`/marketing/campanhas/${id}`)
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Não foi possível criar a campanha')
        } finally {
            setSubmitting(false)
        }
    }

    const visiveis =
        statusFiltro === 'all' ? campanhas : campanhas.filter((c) => c.status === statusFiltro)

    const columns: Column<CampanhaItem>[] = [
        {
            id: 'name',
            header: 'Campanha',
            sortable: true,
            sortValue: (c) => c.name,
            cell: (c) => (
                <div className="flex flex-col">
                    <span className="text-sm text-foreground">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.conteudo}</span>
                </div>
            ),
        },
        {
            id: 'status',
            header: 'Situação',
            sortable: true,
            sortValue: (c) => c.status,
            width: '10rem',
            cell: (c) => <span className="text-sm">{STATUS_CAMPANHA[c.status] ?? c.status}</span>,
        },
        {
            id: 'canal',
            header: 'Canal',
            width: '7rem',
            cell: (c) => <span className="text-sm">{c.canalLabel}</span>,
        },
        {
            id: 'origem',
            header: 'Origem',
            width: '12rem',
            cell: (c) => <span className="text-sm text-muted-foreground">{c.origem}</span>,
        },
        {
            id: 'progress',
            header: 'Enviados',
            width: '9rem',
            className: 'text-right',
            cell: (c) => (
                <span className="num text-sm">
                    {c.sentCount}
                    {c.totalCount > 0 ? ` / ${c.totalCount}` : ''}
                </span>
            ),
        },
    ]

    return (
        <>
            <IndexFrame
                title="Campanhas"
                primary={
                    <div className="flex items-center gap-2">
                        <Select value={statusFiltro} onValueChange={setStatusFiltro}>
                            <SelectTrigger className="h-8 w-40" aria-label="Filtrar por situação">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos</SelectItem>
                                {ORDEM_STATUS.map((s) => (
                                    <SelectItem key={s} value={s}>
                                        {STATUS_CAMPANHA[s]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {canEdit ? (
                            <Button size="sm" className="h-8 gap-1.5" onClick={openNew}>
                                <Plus className="size-3.5" /> Nova campanha
                            </Button>
                        ) : null}
                    </div>
                }
            >
                <DataTable
                    frame
                    columns={columns}
                    rows={visiveis}
                    getRowId={(c) => c.id}
                    loading={loading}
                    onRowClick={(c) => router.push(`/marketing/campanhas/${c.id}`)}
                    empty={
                        <EmptyState
                            variant="inline"
                            icon={Megaphone}
                            title="Nenhuma campanha ainda"
                            description="Dispare para uma lista de contatos — por e-mail, do domínio da unidade, ou por WhatsApp oficial com um template aprovado."
                            action={
                                canEdit ? (
                                    <Button onClick={openNew}>
                                        <Plus /> Nova campanha
                                    </Button>
                                ) : null
                            }
                        />
                    }
                />
            </IndexFrame>

            <RecordDialog
                open={open}
                onOpenChange={setOpen}
                title="Nova campanha"
                description={
                    form.canal === 'email'
                        ? 'Escolha o remetente verificado, o modelo e as listas. Nasce em rascunho — você revisa e dispara na tela seguinte.'
                        : 'Escolha a linha oficial, o template aprovado e as listas. Nasce em rascunho — você revisa e dispara na tela seguinte.'
                }
                submitLabel="Criar campanha"
                hideAgain
                onSubmit={criar}
                submitting={submitting}
            >
                <FormField label="Nome interno" htmlFor="c-name" required className="col-span-2">
                    <Input
                        id="c-name"
                        value={form.name}
                        onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                        placeholder="Retorno semestral — outubro"
                        autoFocus
                    />
                </FormField>

                <FormField label="Rótulos" htmlFor="c-labels" hint="Opcional, separados por vírgula." className="col-span-2">
                    <Input
                        id="c-labels"
                        value={form.labels}
                        onChange={(e) => setForm((p) => ({ ...p, labels: e.target.value }))}
                        placeholder="retorno, ortodontia"
                    />
                </FormField>

                <FormField
                    label="Canal"
                    htmlFor="c-canal"
                    className="col-span-2"
                    hint="Define por onde a campanha sai, quais listas servem e o que precisa estar pronto antes."
                >
                    <Select
                        value={form.canal}
                        onValueChange={(v) => {
                            const canal = v as CanalDeCampanha
                            /**
                             * Trocar de canal limpa o que era do canal anterior.
                             *
                             * Sem isso, um `templateId` de WhatsApp sobreviveria
                             * numa campanha de e-mail: a tela não o mostraria, o
                             * servidor o ignoraria por canal, e ele ficaria
                             * gravado dizendo algo que não é verdade.
                             */
                            setForm((p) => ({
                                ...p,
                                canal,
                                integrationId: '',
                                templateId: '',
                                senderId: '',
                                emailTemplateId: '',
                                subject: '',
                                throttle: RITMO_PADRAO[canal],
                            }))
                            setBodyVars([])
                            setHeaderVars([])
                            // As listas do outro canal não servem a este.
                            setListIds([])
                        }}
                    >
                        <SelectTrigger id="c-canal">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {CANAIS_DE_CAMPANHA.map((c) => (
                                <SelectItem key={c} value={c}>
                                    {NOME_DO_CANAL[c]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>

                {form.canal === 'email' && (
                    <>
                        <FormField
                            label="Remetente"
                            htmlFor="c-sender"
                            required
                            hint="O domínio da unidade. Só aparece aqui depois de verificado."
                        >
                            <Select
                                value={form.senderId}
                                onValueChange={(v) => setForm((p) => ({ ...p, senderId: v }))}
                            >
                                <SelectTrigger id="c-sender">
                                    <SelectValue
                                        placeholder={
                                            remetentesVerificados.length
                                                ? 'Escolha'
                                                : 'Nenhum remetente verificado'
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {remetentesVerificados.map((r) => (
                                        <SelectItem key={r.id} value={r.id}>
                                            {r.from}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormField>

                        <FormField label="Modelo" htmlFor="c-emailtpl" required>
                            <Select
                                value={form.emailTemplateId}
                                onValueChange={(v) =>
                                    setForm((p) => ({ ...p, emailTemplateId: v }))
                                }
                            >
                                <SelectTrigger id="c-emailtpl">
                                    <SelectValue
                                        placeholder={
                                            modelosDeEmail.length ? 'Escolha' : 'Nenhum modelo'
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {modelosDeEmail.map((m) => (
                                        <SelectItem key={m.id} value={m.id}>
                                            {m.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormField>

                        <FormField
                            label="Assunto"
                            htmlFor="c-subject"
                            className="col-span-2"
                            hint={
                                modeloSel?.subject
                                    ? `Em branco, usa o do modelo: "${modeloSel.subject}"`
                                    : 'Obrigatório — o modelo escolhido não tem assunto próprio.'
                            }
                        >
                            <Input
                                id="c-subject"
                                value={form.subject}
                                onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
                                placeholder={modeloSel?.subject ?? '{{nome}}, está na hora do retorno'}
                            />
                        </FormField>

                        {remetentesVerificados.length === 0 && remetentes.length > 0 && (
                            <p className="col-span-2 text-sm text-muted-foreground">
                                Há {remetentes.length} domínio
                                {remetentes.length === 1 ? '' : 's'} cadastrado
                                {remetentes.length === 1 ? '' : 's'}, mas nenhum verificado ainda.
                                Publique os três registros de DNS em Marketing → Remetentes.
                            </p>
                        )}
                    </>
                )}

                {form.canal === 'whatsapp' && (
                    <>
                <FormField label="Linha oficial" htmlFor="c-line" required>
                    <Select
                        value={form.integrationId}
                        onValueChange={(v) => setForm((p) => ({ ...p, integrationId: v, templateId: '' }))}
                    >
                        <SelectTrigger id="c-line">
                            <SelectValue placeholder={linhas.length ? 'Escolha' : 'Nenhuma linha oficial'} />
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

                <FormField label="Template" htmlFor="c-template" required>
                    <Select
                        value={form.templateId}
                        onValueChange={(v) => setForm((p) => ({ ...p, templateId: v }))}
                        disabled={!form.integrationId}
                    >
                        <SelectTrigger id="c-template">
                            <SelectValue
                                placeholder={
                                    !form.integrationId
                                        ? 'Escolha a linha primeiro'
                                        : templatesDaLinha.length
                                          ? 'Escolha'
                                          : 'Nenhum template aprovado'
                                }
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {templatesDaLinha.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                    {t.metaName}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>

                {templateSel && templateSel.variaveis.header > 0 && (
                    <div className="col-span-2 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Variáveis do cabeçalho</p>
                        {Array.from({ length: templateSel.variaveis.header }).map((_, i) => (
                            <Input
                                key={`h-${i}`}
                                value={headerVars[i] ?? ''}
                                onChange={(e) =>
                                    setHeaderVars((prev) => setAt(prev, i, e.target.value, templateSel.variaveis.header))
                                }
                                placeholder={`Cabeçalho {{${i + 1}}}`}
                            />
                        ))}
                    </div>
                )}

                {templateSel && templateSel.variaveis.body > 0 && (
                    <div className="col-span-2 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Variáveis do corpo</p>
                        {Array.from({ length: templateSel.variaveis.body }).map((_, i) => (
                            <Input
                                key={`b-${i}`}
                                value={bodyVars[i] ?? ''}
                                onChange={(e) =>
                                    setBodyVars((prev) => setAt(prev, i, e.target.value, templateSel.variaveis.body))
                                }
                                placeholder={`Corpo {{${i + 1}}}`}
                            />
                        ))}
                    </div>
                )}

                    </>
                )}

                <FormField
                    label="Listas"
                    required
                    hint={
                        form.canal === 'email'
                            ? 'Quem recebe. Só entra contato com e-mail que não cancelou a inscrição.'
                            : 'Quem recebe. Só entra contato com telefone e sem opt-out.'
                    }
                    className="col-span-2"
                >
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
                        {listasDoCanal.length === 0 ? (
                            <p className="px-1 py-2 text-xs text-muted-foreground">
                                Nenhuma lista de {NOME_DO_CANAL[form.canal].toLowerCase()}. Crie uma
                                em Marketing → Listas.
                            </p>
                        ) : (
                            listasDoCanal.map((l) => (
                                <label
                                    key={l.id}
                                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                                >
                                    <span className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={listIds.includes(l.id)}
                                            onChange={() => toggleLista(l.id)}
                                            className="size-4 accent-primary"
                                        />
                                        {l.name}
                                    </span>
                                    <span className="num text-xs text-muted-foreground">{l.memberCount}</span>
                                </label>
                            ))
                        )}
                    </div>
                </FormField>

                <FormField
                    label="Ritmo (por minuto)"
                    htmlFor="c-throttle"
                    hint={
                        form.canal === 'email'
                            ? 'Devagar protege a reputação de um domínio novo — e a cota diária do provedor.'
                            : 'Quantas mensagens por minuto o disparo envia.'
                    }
                >
                    <Input
                        id="c-throttle"
                        type="number"
                        min={1}
                        max={600}
                        value={form.throttle}
                        onChange={(e) => setForm((p) => ({ ...p, throttle: e.target.value }))}
                    />
                </FormField>
            </RecordDialog>
        </>
    )
}

/** Redimensiona um array de variáveis preservando o que já foi digitado. */
function ajustar(prev: string[], n: number): string[] {
    const out = prev.slice(0, n)
    while (out.length < n) out.push('')
    return out
}
function setAt(prev: string[], i: number, value: string, n: number): string[] {
    const out = ajustar(prev, n)
    out[i] = value
    return out
}
