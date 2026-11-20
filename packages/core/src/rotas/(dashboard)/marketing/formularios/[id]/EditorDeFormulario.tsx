'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
    ArrowLeft,
    ChevronDown,
    ChevronUp,
    Copy,
    ExternalLink,
    Globe,
    Loader2,
    Plus,
    Save,
    Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { Textarea } from '@venn/ui/textarea'
import { Switch } from '@venn/ui/switch'
import { Checkbox } from '@venn/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@venn/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@venn/ui/tabs'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@venn/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@venn/ui/popover'
import { cn } from '@venn/ui/utils'
import { InlineField } from '@venn/core/components/shared/InlineField'
import { StatusBadge, FORMULARIO_STATUS } from '@venn/core/components/shared/StatusBadge'
import { TagChip } from '@venn/core/components/shared/TagChip'
import { usePermissions } from '@venn/core/hooks/usePermissions'
import { PICKER_RAMP } from '@venn/core/lib/palette'
import {
    MAPEAMENTOS,
    MAX_CAMPOS,
    NOME_DO_MAPEAMENTO,
    NOME_DO_TIPO,
    RAIOS,
    TEMAS,
    TIPOS_DE_CAMPO,
    idParaCampo,
    motivoParaNaoPublicar,
    type Campo,
    type Configuracao,
    type TipoDeCampo,
} from '@venn/core/lib/formularios/schema'

import { FormularioPublico } from '../../../../f/[key]/FormularioPublico'

/**
 * O editor: campos à esquerda, a prévia real à direita.
 *
 * ## Uma gravação, não uma por campo
 *
 * Diferente da ficha (que grava ao sair do campo), aqui o desenho é um objeto
 * só — reordenar, renomear e marcar obrigatório são edições do mesmo JSON — e
 * gravar cada tecla seria um PUT por letra. Então há **Salvar**, e o botão só
 * acende quando há o que salvar. Publicar salva antes de publicar, para o que
 * está na tela ser o que vai ao ar.
 *
 * ## A prévia é o componente da página pública
 *
 * `FormularioPublico` em modo `previa`: mesma validação, mesma aparência,
 * botão inerte. Uma prévia desenhada à parte divergiria do site na primeira
 * mudança de estilo.
 */

export interface FormularioCarregado {
    id: string
    name: string
    status: string
    publicKey: string
    campos: Campo[]
    config: Configuracao
    originId: string | null
    assignedUserId: string | null
    envios: number
}

interface Envio {
    id: string
    createdAt: string
    pageUrl: string | null
    contato: { id: string; name: string | null; phone: string | null; email: string | null } | null
    resumo: string
}

const NOME_DO_RAIO: Record<(typeof RAIOS)[number], string> = { reto: 'Reto', suave: 'Suave', redondo: 'Arredondado' }
const NOME_DO_TEMA: Record<(typeof TEMAS)[number], string> = { claro: 'Claro', escuro: 'Escuro' }

export function EditorDeFormulario({
    formulario,
    origens,
    etiquetas,
    pessoas,
    baseUrl,
    marca,
}: {
    formulario: FormularioCarregado
    /** O id da unidade — só para a prévia escrever um nome no rodapé. */
    organizacao: string
    origens: { id: string; name: string }[]
    etiquetas: { id: string; name: string; color: string }[]
    pessoas: { userId: string; name: string }[]
    baseUrl: string
    marca: string
}) {
    const router = useRouter()
    const { canEdit } = usePermissions()

    const [name, setName] = useState(formulario.name)
    const [status, setStatus] = useState(formulario.status)
    const [campos, setCampos] = useState<Campo[]>(formulario.campos)
    const [config, setConfig] = useState<Configuracao>(formulario.config)
    const [originId, setOriginId] = useState<string | null>(formulario.originId)
    const [assignedUserId, setAssignedUserId] = useState<string | null>(formulario.assignedUserId)
    const [sujo, setSujo] = useState(false)
    const [salvando, setSalvando] = useState(false)
    const [envios, setEnvios] = useState<Envio[] | null>(null)

    const marcar = <T,>(setter: (v: T) => void) => (v: T) => {
        setter(v)
        setSujo(true)
    }
    const setCamposSujo = marcar(setCampos)
    const setConfigSujo = marcar(setConfig)

    const motivo = useMemo(() => motivoParaNaoPublicar(campos), [campos])
    const urlPublica = `${baseUrl}/f/${formulario.publicKey}`

    const salvar = useCallback(async (): Promise<boolean> => {
        setSalvando(true)
        try {
            const res = await fetch(`/api/marketing/formularios/${formulario.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, fields: campos, settings: config, originId, assignedUserId }),
            })
            const dados = (await res.json().catch(() => ({}))) as { error?: string; campo?: string }
            if (!res.ok) {
                toast.error(dados.error ? `${dados.error}${dados.campo ? ` (${dados.campo})` : ''}` : 'Não foi possível salvar')
                return false
            }
            setSujo(false)
            return true
        } finally {
            setSalvando(false)
        }
    }, [formulario.id, name, campos, config, originId, assignedUserId])

    const mudarStatus = async (novo: 'draft' | 'published') => {
        if (novo === 'published' && motivo) {
            toast.error(motivo)
            return
        }
        if (sujo && !(await salvar())) return
        const res = await fetch(`/api/marketing/formularios/${formulario.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: novo }),
        })
        const dados = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
            toast.error(dados.error || 'Não foi possível mudar a situação')
            return
        }
        setStatus(novo)
        toast.success(novo === 'published' ? 'Formulário publicado' : 'Formulário despublicado')
    }

    const carregarEnvios = useCallback(async () => {
        const res = await fetch(`/api/marketing/formularios/${formulario.id}/envios`)
        if (!res.ok) return
        const dados = (await res.json()) as { envios: Envio[] }
        setEnvios(dados.envios ?? [])
    }, [formulario.id])

    // Sair com edição pendente avisa — o desenho é um objeto só, e perdê-lo é
    // perder a tarde.
    useEffect(() => {
        if (!sujo) return
        const avisar = (e: BeforeUnloadEvent) => {
            e.preventDefault()
        }
        window.addEventListener('beforeunload', avisar)
        return () => window.removeEventListener('beforeunload', avisar)
    }, [sujo])

    const copiar = async (texto: string, oQue: string) => {
        try {
            await navigator.clipboard.writeText(texto)
            toast.success(`${oQue} copiado`)
        } catch {
            toast.error('Não foi possível copiar')
        }
    }

    const snippetIframe = `<iframe src="${urlPublica}?embed=1" title="${name}" style="width:100%;border:0;min-height:480px" loading="lazy"></iframe>
<script>
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.tipo !== 'venn-formulario:altura' || e.data.chave !== '${formulario.publicKey}') return
    document.querySelectorAll('iframe[src^="${urlPublica}"]').forEach(function (f) { f.style.height = e.data.altura + 'px' })
  })
</script>`

    return (
        <div className="flex h-full min-h-0 flex-col">
            {/* O cabeçalho: voltar, o nome editável, a situação, e as duas gravações. */}
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 md:px-6">
                <Button variant="ghost" size="icon" onClick={() => router.push('/marketing/formularios')} aria-label="Voltar para formulários">
                    <ArrowLeft className="size-4" />
                </Button>
                <div className="min-w-0 flex-1">
                    <InlineField
                        value={name}
                        onCommit={(v) => { if (v.trim()) { setName(v.trim()); setSujo(true) } }}
                        ariaLabel="Nome do formulário"
                        disabled={!canEdit}
                        bare
                        className="text-h3"
                    />
                </div>
                <StatusBadge value={status} map={FORMULARIO_STATUS} />
                {canEdit ? (
                    <>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={!sujo || salvando} onClick={() => void salvar()}>
                            {salvando ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                            Salvar
                        </Button>
                        {status === 'published' ? (
                            <Button variant="outline" size="sm" className="h-8" onClick={() => void mudarStatus('draft')}>
                                Despublicar
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                className="h-8 gap-1.5"
                                disabled={!!motivo}
                                title={motivo ?? undefined}
                                onClick={() => void mudarStatus('published')}
                            >
                                <Globe className="size-3.5" />
                                Publicar
                            </Button>
                        )}
                    </>
                ) : null}
            </div>

            <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(380px,460px)_minmax(0,1fr)]">
                {/* A coluna de edição. */}
                <div className="min-h-0 overflow-y-auto border-b border-border p-4 lg:border-b-0 lg:border-r md:px-6">
                    <Tabs defaultValue="campos" onValueChange={(aba) => { if (aba === 'envios' && envios === null) void carregarEnvios() }}>
                        <TabsList className="w-full">
                            <TabsTrigger value="campos">Campos</TabsTrigger>
                            <TabsTrigger value="textos">Aparência</TabsTrigger>
                            <TabsTrigger value="destino">Depois do envio</TabsTrigger>
                            <TabsTrigger value="envios">Envios{formulario.envios ? ` · ${formulario.envios}` : ''}</TabsTrigger>
                            <TabsTrigger value="incorporar">Incorporar</TabsTrigger>
                        </TabsList>

                        <TabsContent value="campos" className="mt-4">
                            <AbaCampos campos={campos} onChange={setCamposSujo} podeEditar={canEdit} />
                            {motivo ? <p className="mt-3 text-xs text-warning-subtle-foreground">{motivo}</p> : null}
                        </TabsContent>

                        <TabsContent value="textos" className="mt-4">
                            <AbaAparencia config={config} onChange={setConfigSujo} podeEditar={canEdit} />
                        </TabsContent>

                        <TabsContent value="destino" className="mt-4">
                            <AbaDestino
                                config={config}
                                onChange={setConfigSujo}
                                originId={originId}
                                onOriginId={marcar(setOriginId)}
                                assignedUserId={assignedUserId}
                                onAssignedUserId={marcar(setAssignedUserId)}
                                origens={origens}
                                etiquetas={etiquetas}
                                pessoas={pessoas}
                                podeEditar={canEdit}
                            />
                        </TabsContent>

                        <TabsContent value="envios" className="mt-4">
                            <AbaEnvios envios={envios} onRecarregar={carregarEnvios} />
                        </TabsContent>

                        <TabsContent value="incorporar" className="mt-4 space-y-4">
                            {status !== 'published' ? (
                                <p className="rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-foreground">
                                    O formulário está em rascunho: o link e o código só funcionam depois de publicar.
                                </p>
                            ) : null}
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Link direto</Label>
                                <div className="flex gap-2">
                                    <Input readOnly value={urlPublica} className="font-mono text-xs" aria-label="Link do formulário" />
                                    <Button variant="outline" size="icon" aria-label="Copiar link" onClick={() => void copiar(urlPublica, 'Link')}>
                                        <Copy className="size-4" />
                                    </Button>
                                    <Button variant="outline" size="icon" aria-label="Abrir em outra aba" asChild>
                                        <a href={urlPublica} target="_blank" rel="noreferrer">
                                            <ExternalLink className="size-4" />
                                        </a>
                                    </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">Para mandar por WhatsApp, e-mail ou botão do site.</p>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Código para o site</Label>
                                <Textarea readOnly value={snippetIframe} rows={8} className="font-mono text-[11px] leading-snug" aria-label="Código de incorporação" />
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs text-muted-foreground">
                                        Cole onde o formulário deve aparecer. A altura se ajusta sozinha.
                                    </p>
                                    <Button variant="outline" size="sm" className="h-8 gap-1.5 shrink-0" onClick={() => void copiar(snippetIframe, 'Código')}>
                                        <Copy className="size-3.5" /> Copiar código
                                    </Button>
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>

                {/* A prévia, viva. */}
                <div className="min-h-0 overflow-y-auto bg-muted/30 p-4 md:p-6">
                    <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Como vai aparecer</p>
                    <FormularioPublico
                        key={`${config.aparencia.tema}-${config.aparencia.raio}`}
                        formulario={{
                            chave: formulario.publicKey,
                            nome: name,
                            organizacao: 'Prévia',
                            campos,
                            config,
                        }}
                        marca={marca}
                        previa
                    />
                </div>
            </div>
        </div>
    )
}

// ───────────────────────────── Campos ─────────────────────────────

function AbaCampos({
    campos,
    onChange,
    podeEditar,
}: {
    campos: Campo[]
    onChange: (c: Campo[]) => void
    podeEditar: boolean
}) {
    const acrescentar = (tipo: TipoDeCampo) => {
        if (campos.length >= MAX_CAMPOS) {
            toast.error(`No máximo ${MAX_CAMPOS} campos`)
            return
        }
        const rotulo = NOME_DO_TIPO[tipo]
        const novo: Campo = {
            id: idParaCampo(rotulo, campos.map((c) => c.id)),
            tipo,
            rotulo,
            obrigatorio: false,
            largura: 'cheia',
            // Telefone e e-mail já nascem indo para a ficha: é o que quase
            // sempre se quer, e o que o portão de publicar exige de um deles.
            mapeia: tipo === 'telefone' ? 'telefone' : tipo === 'email' ? 'email' : 'nenhum',
            ...(tipo === 'selecao' || tipo === 'multipla' ? { opcoes: ['Opção 1', 'Opção 2'] } : {}),
        }
        onChange([...campos, novo])
    }

    const trocar = (i: number, patch: Partial<Campo>) => {
        const proximos = [...campos]
        proximos[i] = { ...proximos[i], ...patch }
        onChange(proximos)
    }

    const mover = (i: number, direcao: -1 | 1) => {
        const j = i + direcao
        if (j < 0 || j >= campos.length) return
        const proximos = [...campos]
        ;[proximos[i], proximos[j]] = [proximos[j], proximos[i]]
        onChange(proximos)
    }

    return (
        <div className="space-y-3">
            {campos.map((campo, i) => (
                <EditorDeCampo
                    key={campo.id}
                    campo={campo}
                    primeiro={i === 0}
                    ultimo={i === campos.length - 1}
                    podeEditar={podeEditar}
                    onChange={(patch) => trocar(i, patch)}
                    onSubir={() => mover(i, -1)}
                    onDescer={() => mover(i, 1)}
                    onRemover={() => onChange(campos.filter((_, k) => k !== i))}
                />
            ))}

            {podeEditar ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full gap-1.5 border-dashed">
                            <Plus className="size-4" /> Acrescentar campo
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-56">
                        {TIPOS_DE_CAMPO.map((tipo) => (
                            <DropdownMenuItem key={tipo} onSelect={() => acrescentar(tipo)}>
                                {NOME_DO_TIPO[tipo]}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
        </div>
    )
}

function EditorDeCampo({
    campo,
    primeiro,
    ultimo,
    podeEditar,
    onChange,
    onSubir,
    onDescer,
    onRemover,
}: {
    campo: Campo
    primeiro: boolean
    ultimo: boolean
    podeEditar: boolean
    onChange: (patch: Partial<Campo>) => void
    onSubir: () => void
    onDescer: () => void
    onRemover: () => void
}) {
    const [aberto, setAberto] = useState(false)
    const comOpcoes = campo.tipo === 'selecao' || campo.tipo === 'multipla'
    const comTexto = campo.tipo === 'texto' || campo.tipo === 'paragrafo'

    return (
        <div className="rounded-md border border-border bg-card">
            <div className="flex items-center gap-2 px-2 py-2">
                <div className="flex flex-col">
                    <button type="button" onClick={onSubir} disabled={primeiro || !podeEditar} aria-label="Subir" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                        <ChevronUp className="size-3.5" />
                    </button>
                    <button type="button" onClick={onDescer} disabled={ultimo || !podeEditar} aria-label="Descer" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                        <ChevronDown className="size-3.5" />
                    </button>
                </div>
                <button type="button" onClick={() => setAberto((a) => !a)} className="min-w-0 flex-1 text-left" aria-expanded={aberto}>
                    <span className="block truncate text-sm font-medium">
                        {campo.rotulo}
                        {campo.obrigatorio ? <span className="ml-0.5 text-destructive">*</span> : null}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                        {NOME_DO_TIPO[campo.tipo]}
                        {campo.mapeia !== 'nenhum' ? ` · vai para ${NOME_DO_MAPEAMENTO[campo.mapeia]}` : ''}
                    </span>
                </button>
                <Switch
                    checked={campo.obrigatorio}
                    disabled={!podeEditar}
                    aria-label={`${campo.rotulo} é obrigatório`}
                    onCheckedChange={(obrigatorio) => onChange({ obrigatorio })}
                />
                <Button variant="ghost" size="icon-sm" disabled={!podeEditar} aria-label={`Remover o campo ${campo.rotulo}`} onClick={onRemover}>
                    <Trash2 className="size-3.5 text-muted-foreground" />
                </Button>
            </div>

            {aberto ? (
                <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
                    <div className="space-y-1 sm:col-span-2">
                        <Label htmlFor={`c-${campo.id}-rotulo`} className="text-xs">Rótulo</Label>
                        <Input id={`c-${campo.id}-rotulo`} value={campo.rotulo} disabled={!podeEditar} maxLength={120} onChange={(e) => onChange({ rotulo: e.target.value })} />
                    </div>
                    {campo.tipo !== 'caixa' && campo.tipo !== 'multipla' ? (
                        <div className="space-y-1">
                            <Label htmlFor={`c-${campo.id}-ph`} className="text-xs">Exemplo dentro do campo</Label>
                            <Input id={`c-${campo.id}-ph`} value={campo.placeholder ?? ''} disabled={!podeEditar} maxLength={120} onChange={(e) => onChange({ placeholder: e.target.value })} />
                        </div>
                    ) : null}
                    <div className="space-y-1">
                        <Label htmlFor={`c-${campo.id}-ajuda`} className="text-xs">Texto de apoio</Label>
                        <Input id={`c-${campo.id}-ajuda`} value={campo.ajuda ?? ''} disabled={!podeEditar} maxLength={200} onChange={(e) => onChange({ ajuda: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Vai para a ficha como</Label>
                        <Select value={campo.mapeia} disabled={!podeEditar} onValueChange={(v) => onChange({ mapeia: v as Campo['mapeia'] })}>
                            <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {MAPEAMENTOS.map((m) => (
                                    <SelectItem key={m} value={m}>{NOME_DO_MAPEAMENTO[m]}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Largura</Label>
                        <Select value={campo.largura} disabled={!podeEditar} onValueChange={(v) => onChange({ largura: v as Campo['largura'] })}>
                            <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="cheia">Linha inteira</SelectItem>
                                <SelectItem value="metade">Meia linha</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {comOpcoes ? (
                        <div className="space-y-1 sm:col-span-2">
                            <Label htmlFor={`c-${campo.id}-op`} className="text-xs">Opções, uma por linha</Label>
                            <Textarea
                                id={`c-${campo.id}-op`}
                                rows={4}
                                disabled={!podeEditar}
                                value={(campo.opcoes ?? []).join('\n')}
                                onChange={(e) => onChange({ opcoes: e.target.value.split('\n').map((o) => o.trim()).filter(Boolean).slice(0, 50) })}
                            />
                        </div>
                    ) : null}
                    {comTexto || campo.tipo === 'numero' ? (
                        <>
                            <div className="space-y-1">
                                <Label htmlFor={`c-${campo.id}-min`} className="text-xs">{campo.tipo === 'numero' ? 'Mínimo' : 'Mínimo de caracteres'}</Label>
                                <Input id={`c-${campo.id}-min`} type="number" min={0} disabled={!podeEditar} value={campo.validacao?.min ?? ''} onChange={(e) => onChange({ validacao: { ...campo.validacao, min: e.target.value === '' ? undefined : Number(e.target.value) } })} />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor={`c-${campo.id}-max`} className="text-xs">{campo.tipo === 'numero' ? 'Máximo' : 'Máximo de caracteres'}</Label>
                                <Input id={`c-${campo.id}-max`} type="number" min={0} disabled={!podeEditar} value={campo.validacao?.max ?? ''} onChange={(e) => onChange({ validacao: { ...campo.validacao, max: e.target.value === '' ? undefined : Number(e.target.value) } })} />
                            </div>
                        </>
                    ) : null}
                    {comTexto ? (
                        <div className="space-y-1 sm:col-span-2">
                            <Label htmlFor={`c-${campo.id}-re`} className="text-xs">Formato (expressão regular, opcional)</Label>
                            <Input id={`c-${campo.id}-re`} className="font-mono text-xs" placeholder="^[0-9]{5}-?[0-9]{3}$" disabled={!podeEditar} maxLength={200} value={campo.validacao?.padrao ?? ''} onChange={(e) => onChange({ validacao: { ...campo.validacao, padrao: e.target.value || undefined } })} />
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

// ───────────────────────────── Aparência ─────────────────────────────

function AbaAparencia({
    config,
    onChange,
    podeEditar,
}: {
    config: Configuracao
    onChange: (c: Configuracao) => void
    podeEditar: boolean
}) {
    const set = (patch: Partial<Configuracao>) => onChange({ ...config, ...patch })
    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <Label htmlFor="cfg-titulo" className="text-xs">Título</Label>
                <Input id="cfg-titulo" value={config.titulo} disabled={!podeEditar} maxLength={120} placeholder="Peça um orçamento" onChange={(e) => set({ titulo: e.target.value })} />
                <p className="text-xs text-muted-foreground">Vazio usa o nome do formulário.</p>
            </div>
            <div className="space-y-1">
                <Label htmlFor="cfg-desc" className="text-xs">Descrição</Label>
                <Textarea id="cfg-desc" rows={3} value={config.descricao} disabled={!podeEditar} maxLength={500} placeholder="Preencha e nossa equipe retorna em até um dia útil." onChange={(e) => set({ descricao: e.target.value })} />
            </div>
            <div className="space-y-1">
                <Label htmlFor="cfg-botao" className="text-xs">Texto do botão</Label>
                <Input id="cfg-botao" value={config.textoDoBotao} disabled={!podeEditar} maxLength={40} onChange={(e) => set({ textoDoBotao: e.target.value })} />
            </div>
            <div className="space-y-1">
                <Label htmlFor="cfg-lgpd" className="text-xs">Texto de aceite (abaixo do botão)</Label>
                <Textarea id="cfg-lgpd" rows={2} value={config.consentimento} disabled={!podeEditar} maxLength={300} placeholder="Ao enviar, você concorda em receber contato pelos dados informados." onChange={(e) => set({ consentimento: e.target.value })} />
                <p className="text-xs text-muted-foreground">Para exigir uma marcação, acrescente um campo «Caixa de marcar» obrigatório.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                    <Label className="text-xs">Cor</Label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <button type="button" disabled={!podeEditar} aria-label="Cor do formulário" className="flex h-9 w-full items-center gap-2 rounded-md border border-input px-3 text-sm">
                                <span className="size-4 rounded-full" style={{ backgroundColor: config.aparencia.cor }} />
                                <span className="font-mono text-xs">{config.aparencia.cor}</span>
                            </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2">
                            <div className="flex gap-1.5" role="radiogroup" aria-label="Cor do formulário">
                                {PICKER_RAMP.map((hex) => (
                                    <button
                                        key={hex}
                                        type="button"
                                        role="radio"
                                        aria-checked={config.aparencia.cor === hex}
                                        aria-label={`Cor ${hex}`}
                                        onClick={() => set({ aparencia: { ...config.aparencia, cor: hex } })}
                                        className={cn('size-6 rounded-full ring-offset-2 ring-offset-popover', config.aparencia.cor === hex ? 'ring-2 ring-ring' : 'hover:ring-2 hover:ring-border')}
                                        style={{ backgroundColor: hex }}
                                    />
                                ))}
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
                <div className="space-y-1">
                    <Label className="text-xs">Cantos</Label>
                    <Select value={config.aparencia.raio} disabled={!podeEditar} onValueChange={(v) => set({ aparencia: { ...config.aparencia, raio: v as Configuracao['aparencia']['raio'] } })}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {RAIOS.map((r) => <SelectItem key={r} value={r}>{NOME_DO_RAIO[r]}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1">
                    <Label className="text-xs">Tema</Label>
                    <Select value={config.aparencia.tema} disabled={!podeEditar} onValueChange={(v) => set({ aparencia: { ...config.aparencia, tema: v as Configuracao['aparencia']['tema'] } })}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {TEMAS.map((t) => <SelectItem key={t} value={t}>{NOME_DO_TEMA[t]}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </div>
    )
}

// ───────────────────────────── Depois do envio ─────────────────────────────

const NENHUM = '__nenhum__'

function AbaDestino({
    config,
    onChange,
    originId,
    onOriginId,
    assignedUserId,
    onAssignedUserId,
    origens,
    etiquetas,
    pessoas,
    podeEditar,
}: {
    config: Configuracao
    onChange: (c: Configuracao) => void
    originId: string | null
    onOriginId: (v: string | null) => void
    assignedUserId: string | null
    onAssignedUserId: (v: string | null) => void
    origens: { id: string; name: string }[]
    etiquetas: { id: string; name: string; color: string }[]
    pessoas: { userId: string; name: string }[]
    podeEditar: boolean
}) {
    const set = (patch: Partial<Configuracao>) => onChange({ ...config, ...patch })
    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <Label htmlFor="cfg-sucesso" className="text-xs">Mensagem depois do envio</Label>
                <Textarea id="cfg-sucesso" rows={3} value={config.mensagemDeSucesso} disabled={!podeEditar} maxLength={500} onChange={(e) => set({ mensagemDeSucesso: e.target.value })} />
            </div>
            <div className="space-y-1">
                <Label htmlFor="cfg-redir" className="text-xs">Ou redirecionar para</Label>
                <Input id="cfg-redir" type="url" value={config.redirecionarPara} disabled={!podeEditar} maxLength={500} placeholder="https://seusite.com.br/obrigado" onChange={(e) => set({ redirecionarPara: e.target.value })} />
                <p className="text-xs text-muted-foreground">Vazio mostra a mensagem acima. Preenchido, a pessoa vai para esta página.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                    <Label className="text-xs">Origem da ficha</Label>
                    <Select value={originId ?? NENHUM} disabled={!podeEditar} onValueChange={(v) => onOriginId(v === NENHUM ? null : v)}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NENHUM}>Não informar</SelectItem>
                            {origens.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1">
                    <Label className="text-xs">Responsável pelo negócio</Label>
                    <Select value={assignedUserId ?? NENHUM} disabled={!podeEditar} onValueChange={(v) => onAssignedUserId(v === NENHUM ? null : v)}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NENHUM}>Sem dono — fica na fila</SelectItem>
                            {pessoas.map((p) => <SelectItem key={p.userId} value={p.userId}>{p.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                <div>
                    <p className="text-sm font-medium">Abrir um negócio no funil padrão</p>
                    <p className="text-xs text-muted-foreground">Na primeira fase, com as respostas nas observações. Quem já tem negócio aberto lá não ganha outro.</p>
                </div>
                <Switch checked={config.criarNegocio} disabled={!podeEditar} aria-label="Abrir um negócio no funil padrão" onCheckedChange={(criarNegocio) => set({ criarNegocio })} />
            </div>

            {etiquetas.length ? (
                <div className="space-y-2">
                    <Label className="text-xs">Etiquetas que a ficha recebe</Label>
                    <div className="flex flex-wrap gap-2">
                        {etiquetas.map((t) => {
                            const marcada = config.tagIds.includes(t.id)
                            return (
                                <label key={t.id} className="flex cursor-pointer items-center gap-1.5">
                                    <Checkbox
                                        checked={marcada}
                                        disabled={!podeEditar}
                                        onCheckedChange={(c) =>
                                            set({ tagIds: c ? [...config.tagIds, t.id] : config.tagIds.filter((id) => id !== t.id) })
                                        }
                                    />
                                    <TagChip name={t.name} color={t.color} size="sm" />
                                </label>
                            )
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    )
}

// ───────────────────────────── Envios ─────────────────────────────

function AbaEnvios({ envios, onRecarregar }: { envios: Envio[] | null; onRecarregar: () => Promise<void> }) {
    if (envios === null) {
        return <p className="text-xs text-muted-foreground">Carregando envios…</p>
    }
    if (envios.length === 0) {
        return <p className="text-sm text-muted-foreground">Nenhum envio ainda. Quando alguém preencher o formulário, aparece aqui e vira ficha.</p>
    }
    return (
        <div className="space-y-2">
            <div className="flex justify-end">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void onRecarregar()}>Atualizar</Button>
            </div>
            {envios.map((e) => (
                <div key={e.id} className="rounded-md border border-border bg-card px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                            {e.contato?.name || e.contato?.phone || e.contato?.email || 'Sem ficha'}
                        </span>
                        <span className="num shrink-0 text-xs text-muted-foreground">
                            {new Date(e.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{e.resumo}</p>
                    {e.pageUrl ? <p className="mt-1 truncate text-[11px] text-muted-foreground/70">{e.pageUrl}</p> : null}
                </div>
            ))}
        </div>
    )
}
