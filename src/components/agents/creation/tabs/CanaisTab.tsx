'use client'

import { useCallback, useEffect, useState } from 'react'
import {
    BadgeCheck,
    Facebook,
    Instagram,
    Loader2,
    Pencil,
    Plus,
    Power,
    QrCode,
    RefreshCw,
    Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SettingsCard, SettingsRow } from '@/components/shared/TabsFrame'
import { InstagramConnect } from '@/components/agents/creation/InstagramConnect'
import { MetaEmbeddedSignup } from '@/components/agents/creation/MetaEmbeddedSignup'
import { formatPhone } from '@/lib/phone'
import { cn } from '@/lib/utils'
import { WhatsAppQRModal } from '../WhatsAppQRModal'

/**
 * Os canais do agente — e, no WhatsApp, as **linhas** dele.
 *
 * A aba oferecia um cartão por canal e um botão Conectar, o que embutia na tela
 * a regra de um número por agente: não havia onde um segundo número aparecer.
 * Uma clínica com duas unidades no mesmo agente precisava de dois agentes
 * iguais, cada um com seu número, e as conversas das duas unidades se
 * misturavam num fio só.
 *
 * Aqui o WhatsApp é uma lista: cada linha tem nome, número, estado e as suas
 * ações. O teto é o do plano, dito antes do clique em vez de depois.
 */

interface Line {
    id: string
    label: string | null
    departmentId: string | null
    phoneNumber: string | null
    status: string
    connectedAt: string | null
    lastActiveAt: string | null
    errorMessage: string | null
    paired: boolean
}

interface LineLimit {
    used: number
    max: number
    remaining: number
}

interface CanaisTabProps {
    agentId?: string | null
    /**
     * Se quem olha pode mexer nas linhas.
     *
     * Conectar e desconectar um número é de administrador: um clique errado
     * aqui derruba o WhatsApp da clínica inteira. Quem não administra lê a
     * lista — qual número, qual fila, se está no ar — e não vê os botões.
     */
    canManage?: boolean
}

/**
 * Os canais que ainda não existem, ditos como tal.
 *
 * Dois saíram daqui ao ganhar botão: o WhatsApp oficial e, depois dele, o
 * Instagram — que passou a ter cartão próprio, logo abaixo. Sobrou o Facebook,
 * que é de verdade o único ainda por fazer.
 */
const OUTROS_CANAIS = [
    {
        id: 'facebook',
        name: 'Messenger',
        description: 'Mensagens da página da clínica no Facebook',
        icon: Facebook,
    },
]

const ESTADO: Record<string, { rotulo: string; classe: string }> = {
    connected: {
        rotulo: 'No ar',
        classe: 'bg-success-subtle text-success-subtle-foreground',
    },
    pending: {
        rotulo: 'Pareando',
        classe: 'bg-warning-subtle text-warning-subtle-foreground',
    },
    error: {
        rotulo: 'Com erro',
        classe: 'bg-destructive-subtle text-destructive-subtle-foreground',
    },
    disconnected: {
        rotulo: 'Desconectada',
        classe: 'bg-muted text-muted-foreground',
    },
}

/** O nome da linha na tela: o apelido, senão o número, senão "Linha nova". */
function nomeDaLinha(line: Line): string {
    if (line.label?.trim()) return line.label.trim()
    if (line.phoneNumber) return formatPhone(line.phoneNumber)
    return 'Linha sem número'
}

export function CanaisTab({ agentId, canManage = true }: CanaisTabProps) {
    const [lines, setLines] = useState<Line[]>([])
    const [departments, setDepartments] = useState<{ id: string; name: string }[]>([])
    const [limit, setLimit] = useState<LineLimit | null>(null)
    const [loading, setLoading] = useState(Boolean(agentId))
    const [ocupada, setOcupada] = useState<string | null>(null)
    const [pareando, setPareando] = useState<string | null>(null)
    const [renomeando, setRenomeando] = useState<string | null>(null)
    const [rascunho, setRascunho] = useState('')
    const [aRemover, setARemover] = useState<Line | null>(null)
    const [aDesconectar, setADesconectar] = useState<Line | null>(null)

    /** O canal do site: chave pública e o trecho que a clínica cola. */
    const [site, setSite] = useState<{ connected: boolean; snippet?: string } | null>(null)
    const [ligandoSite, setLigandoSite] = useState(false)
    const [copiado, setCopiado] = useState(false)

    const carregar = useCallback(async () => {
        if (!agentId) return
        try {
            const res = await fetch(`/api/agents/${agentId}/integrations/whatsapp`)
            if (!res.ok) return
            const data = await res.json()
            setLines(data.lines ?? [])
            setLimit(data.limit ?? null)
            setDepartments(data.departments ?? [])
        } finally {
            setLoading(false)
        }
    }, [agentId])

    useEffect(() => {
        void carregar()
    }, [carregar])

    const carregarSite = useCallback(async () => {
        if (!agentId) return
        const res = await fetch(`/api/agents/${agentId}/integrations/site`)
        if (res.ok) setSite(await res.json())
    }, [agentId])

    useEffect(() => {
        void carregarSite()
    }, [carregarSite])

    const alternarSite = async (ligar: boolean) => {
        setLigandoSite(true)
        try {
            const res = await fetch(`/api/agents/${agentId}/integrations/site`, {
                method: ligar ? 'POST' : 'DELETE',
            })
            if (!res.ok) {
                const corpo = await res.json().catch(() => ({}))
                toast.error(corpo.error ?? 'Não foi possível alterar o canal do site')
                return
            }
            toast.success(ligar ? 'Widget do site ligado' : 'Widget do site desligado')
            await carregarSite()
        } finally {
            setLigandoSite(false)
        }
    }

    /**
     * Adicionar uma linha é abrir o pareamento, não gravar um registro.
     *
     * O registro nasce no servidor junto com a instância no provedor, porque o
     * nome dela é o id dele. Aqui só se abre o modal, que o POST atende.
     */
    const adicionar = () => setPareando('nova')

    const reconectar = (line: Line) => setPareando(line.id)

    const desconectar = async (line: Line) => {
        setOcupada(line.id)
        try {
            const res = await fetch(
                `/api/agents/${agentId}/integrations/whatsapp?integrationId=${line.id}`,
                { method: 'DELETE' }
            )
            const body = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(body.error ?? 'Não foi possível desconectar')
                return
            }
            toast.success(`${nomeDaLinha(line)} foi desconectada`)
            await carregar()
        } finally {
            setOcupada(null)
        }
    }

    const remover = async (line: Line) => {
        setOcupada(line.id)
        try {
            const res = await fetch(
                `/api/agents/${agentId}/integrations/whatsapp?integrationId=${line.id}&remove=true`,
                { method: 'DELETE' }
            )
            const body = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(body.error ?? 'Não foi possível remover a linha')
                return
            }
            toast.success('Linha removida')
            await carregar()
        } finally {
            setOcupada(null)
        }
    }

    const ajustar = async (
        line: Line,
        patch: { label?: string; departmentId?: string | null }
    ) => {
        const res = await fetch(`/api/agents/${agentId}/integrations/whatsapp`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ integrationId: line.id, ...patch }),
        })
        if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            toast.error(body.error ?? 'Não foi possível salvar')
            return
        }
        await carregar()
    }

    const renomear = async (line: Line) => {
        const label = rascunho.trim()
        setRenomeando(null)
        if (label === (line.label ?? '')) return
        await ajustar(line, { label })
    }

    const semVaga = limit !== null && limit.remaining <= 0

    if (!agentId) {
        return (
            <SettingsCard
                title="Canais de atendimento"
                description="Salve o agente antes de conectar um canal — a linha precisa pertencer a alguém."
            >
                <p className="text-xs text-muted-foreground">
                    Depois de salvar, volte aqui para ler o QR Code do WhatsApp.
                </p>
            </SettingsCard>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            <SettingsCard
                title="Linhas de WhatsApp"
                description="Cada linha é um número. Um agente pode atender por vários — uma por unidade, por exemplo — e cada conversa responde pela linha por onde ela entrou. A fila diz quem vê essas conversas em Conversas: o departamento escolhido, ou todo mundo na fila geral."
                aside={
                    limit ? (
                        <span className="num text-xs text-muted-foreground">
                            {limit.used} de {limit.max} no plano
                        </span>
                    ) : null
                }
                footer={
                    canManage ? (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">
                                {semVaga
                                    ? 'O plano está no limite de números. Mude de plano em Gerenciamento → Conta para conectar mais.'
                                    : 'Conectar pede a leitura de um QR Code no aparelho que tem o número.'}
                            </p>
                            <Button size="sm" onClick={adicionar} disabled={semVaga}>
                                <Plus className="size-4" />
                                Adicionar número
                            </Button>
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground">
                            Conectar e desconectar números é do dono ou do administrador da clínica.
                        </p>
                    )
                }
            >
                {loading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        Carregando as linhas…
                    </div>
                ) : lines.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-6 text-center">
                        <QrCode className="size-8 text-muted-foreground/40" aria-hidden="true" />
                        <p className="text-[13px] font-semibold">Nenhum número conectado</p>
                        <p className="max-w-sm text-xs text-muted-foreground">
                            Enquanto não houver uma linha, o agente não recebe nem responde
                            mensagens no WhatsApp.
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col divide-y divide-border">
                        {lines.map((line) => {
                            const estado = ESTADO[line.status] ?? ESTADO.disconnected
                            const trabalhando = ocupada === line.id
                            return (
                                <div key={line.id} className="py-3 first:pt-0 last:pb-0">
                                    <SettingsRow
                                        title={
                                            canManage && renomeando === line.id ? (
                                                <Input
                                                    autoFocus
                                                    value={rascunho}
                                                    maxLength={60}
                                                    placeholder="Unidade Centro"
                                                    className="h-8 max-w-xs"
                                                    onChange={(e) => setRascunho(e.target.value)}
                                                    onBlur={() => void renomear(line)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') void renomear(line)
                                                        if (e.key === 'Escape') setRenomeando(null)
                                                    }}
                                                />
                                            ) : (
                                                <span className="flex items-center gap-2">
                                                    {nomeDaLinha(line)}
                                                    <span
                                                        className={cn(
                                                            'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                                            estado.classe
                                                        )}
                                                    >
                                                        {estado.rotulo}
                                                    </span>
                                                </span>
                                            )
                                        }
                                        description={
                                            line.errorMessage ? (
                                                <span className="text-destructive-subtle-foreground">
                                                    {line.errorMessage}
                                                </span>
                                            ) : line.label && line.phoneNumber ? (
                                                <span className="num">{formatPhone(line.phoneNumber)}</span>
                                            ) : line.paired ? (
                                                'Já pareada; reconectar não pede QR Code novo.'
                                            ) : (
                                                'Ainda não pareada.'
                                            )
                                        }
                                        action={
                                            !canManage ? null : (
                                            <div className="flex items-center gap-1">
                                                {/* De quem é a fila desta linha. Só
                                                    aparece quando a clínica tem
                                                    departamentos — sem eles o seletor
                                                    não decide nada. */}
                                                {departments.length > 0 ? (
                                                    <Select
                                                        value={line.departmentId ?? 'none'}
                                                        onValueChange={(v) =>
                                                            void ajustar(line, {
                                                                departmentId: v === 'none' ? null : v,
                                                            })
                                                        }
                                                    >
                                                        <SelectTrigger
                                                            aria-label={`Fila de ${nomeDaLinha(line)}`}
                                                            className="h-8 w-[10.5rem] text-xs"
                                                        >
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="none">Fila geral</SelectItem>
                                                            {departments.map((d) => (
                                                                <SelectItem key={d.id} value={d.id}>
                                                                    {d.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : null}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={`Renomear ${nomeDaLinha(line)}`}
                                                    onClick={() => {
                                                        setRascunho(line.label ?? '')
                                                        setRenomeando(line.id)
                                                    }}
                                                >
                                                    <Pencil className="size-4" />
                                                </Button>
                                                {line.status === 'connected' ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={trabalhando}
                                                        onClick={() => setADesconectar(line)}
                                                    >
                                                        {trabalhando ? (
                                                            <Loader2 className="size-4 animate-spin" />
                                                        ) : (
                                                            <Power className="size-4" />
                                                        )}
                                                        Desconectar
                                                    </Button>
                                                ) : (
                                                    <>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            disabled={trabalhando}
                                                            onClick={() => reconectar(line)}
                                                        >
                                                            <RefreshCw className="size-4" />
                                                            {line.paired ? 'Reconectar' : 'Conectar'}
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            aria-label={`Remover ${nomeDaLinha(line)}`}
                                                            disabled={trabalhando}
                                                            onClick={() => setARemover(line)}
                                                        >
                                                            <Trash2 className="size-4 text-destructive-subtle-foreground" />
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                            )
                                        }
                                    />
                                </div>
                            )
                        })}
                    </div>
                )}
            </SettingsCard>

            <SettingsCard
                title="Site da clínica"
                description="Uma bolha de conversa nas páginas do site. Diferente do WhatsApp, não ocupa número do plano — o que ele consome é crédito de IA, por mensagem."
                aside={
                    <span
                        className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                            site?.connected
                                ? 'bg-success-subtle text-success-subtle-foreground'
                                : 'bg-muted text-muted-foreground'
                        )}
                    >
                        {site?.connected ? 'No ar' : 'Desligado'}
                    </span>
                }
                footer={
                    canManage ? (
                        <Button
                            variant={site?.connected ? 'outline' : 'default'}
                            size="sm"
                            disabled={ligandoSite}
                            onClick={() => void alternarSite(!site?.connected)}
                        >
                            {site?.connected ? 'Desligar o widget' : 'Ligar o widget'}
                        </Button>
                    ) : null
                }
            >
                {site?.connected && site.snippet ? (
                    <div className="flex flex-col gap-2">
                        <p className="text-xs text-muted-foreground">
                            Cole este trecho no site, antes de <code>&lt;/body&gt;</code>. Uma vez
                            só — desligar e religar aqui não muda o código.
                        </p>
                        <div className="flex items-start gap-2">
                            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted/50 p-2.5 text-[11px] leading-relaxed">
                                {site.snippet}
                            </code>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    void navigator.clipboard.writeText(site.snippet ?? '')
                                    setCopiado(true)
                                    setTimeout(() => setCopiado(false), 2000)
                                }}
                            >
                                {copiado ? 'Copiado' : 'Copiar'}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        Ligue para gerar o código que vai no site.
                    </p>
                )}
            </SettingsCard>

            {/* O WhatsApp oficial ganhou cartão próprio: ele conecta de verdade
                agora, e deixá-lo entre os "em breve" seria esconder o botão. */}
            <SettingsCard
                title="WhatsApp API Oficial"
                description="Número verificado pela Meta, sem leitura de QR Code e sem depender de um celular ligado."
            >
                <SettingsRow
                    title={
                        <span className="flex items-center gap-2">
                            <BadgeCheck className="size-4 text-muted-foreground" aria-hidden="true" />
                            Conectar pela Meta
                        </span>
                    }
                    description="A clínica escolhe o próprio número numa janela da Meta. Nenhuma credencial passa por aqui."
                    action={
                        canManage ? (
                            <MetaEmbeddedSignup agentId={agentId} onConectado={() => void carregar()} />
                        ) : (
                            <span className="text-[11px] text-muted-foreground">
                                Só o administrador conecta
                            </span>
                        )
                    }
                />
            </SettingsCard>

            {/* O Instagram vai direto à Meta: não há Evolution no caminho,
                porque ele não tem canal de Instagram — e também não teria o que
                fazer ali, já que a API de Direct é aberta e gratuita. */}
            <SettingsCard
                title="Instagram"
                description="O Direct da conta profissional da clínica. Não ocupa número do plano — o que ele consome é crédito de IA, por mensagem."
            >
                <SettingsRow
                    title={
                        <span className="flex items-center gap-2">
                            <Instagram className="size-4 text-muted-foreground" aria-hidden="true" />
                            Conectar pela Meta
                        </span>
                    }
                    description="A conta precisa ser profissional e estar ligada a uma Página do Facebook. Nenhuma credencial passa por aqui."
                    action={
                        agentId ? (
                            <InstagramConnect agentId={agentId} canManage={canManage} />
                        ) : (
                            <span className="text-[11px] text-muted-foreground">
                                Salve o agente primeiro
                            </span>
                        )
                    }
                />
            </SettingsCard>

            <SettingsCard
                title="Outros canais"
                description="Em desenvolvimento. Nenhum deles aparece como conectado enquanto não atender de verdade."
            >
                <div className="flex flex-col gap-4">
                    {OUTROS_CANAIS.map((canal, i) => {
                        const Icone = canal.icon
                        return (
                            <div key={canal.id} className={cn(i > 0 && 'border-t border-border pt-4')}>
                                <SettingsRow
                                    title={
                                        <span className="flex items-center gap-2">
                                            <Icone className="size-4 text-muted-foreground" aria-hidden="true" />
                                            {canal.name}
                                        </span>
                                    }
                                    description={canal.description}
                                    action={
                                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                            Em breve
                                        </span>
                                    }
                                />
                            </div>
                        )
                    })}
                </div>
            </SettingsCard>

            {pareando ? (
                <WhatsAppQRModal
                    agentId={agentId}
                    integrationId={pareando === 'nova' ? null : pareando}
                    isOpen
                    onClose={() => {
                        setPareando(null)
                        void carregar()
                    }}
                    onConnected={() => void carregar()}
                />
            ) : null}

            <ConfirmDialog
                open={aDesconectar !== null}
                onOpenChange={(aberto) => {
                    if (!aberto) setADesconectar(null)
                }}
                title="Desconectar esta linha?"
                description={
                    aDesconectar
                        ? `${nomeDaLinha(aDesconectar)} para de receber e de enviar mensagens na hora. ` +
                          'As conversas e o histórico ficam, e reconectar não pede QR Code novo enquanto ' +
                          'a sessão do aparelho continuar válida. A linha segue ocupando a vaga do plano.'
                        : ''
                }
                confirmLabel="Desconectar"
                cancelLabel="Manter conectada"
                destructive
                onConfirm={() => (aDesconectar ? desconectar(aDesconectar) : Promise.resolve())}
            />

            <ConfirmDialog
                open={aRemover !== null}
                onOpenChange={(aberto) => {
                    if (!aberto) setARemover(null)
                }}
                title="Remover esta linha?"
                description={
                    aRemover
                        ? `${nomeDaLinha(aRemover)} sai da lista e devolve a vaga do plano. ` +
                          'As conversas que entraram por ela continuam guardadas, mas deixam de ' +
                          'registrar por qual número chegaram. Esta ação não tem volta.'
                        : ''
                }
                confirmLabel="Remover linha"
                cancelLabel="Manter na lista"
                destructive
                onConfirm={() => (aRemover ? remover(aRemover) : Promise.resolve())}
            />
        </div>
    )
}
