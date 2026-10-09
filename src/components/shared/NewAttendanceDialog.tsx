'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, MessageCircle, Phone, Route, TriangleAlert, User } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface LookupResult {
    valid: boolean
    /** A forma que será gravada — pode diferir da digitada. */
    phone: string
    typed?: string
    formatted: string
    existing?: {
        contactId: string
        name: string | null
        dealId: string | null
        stageName: string | null
        conversationId: string | null
        lastMessageAt: string | null
    } | null
    whatsapp?: boolean | null
    channelConnected?: boolean
}

interface Option { id: string; name: string }

export interface IntakeResult {
    conversationId: string
    contactId: string
    dealId: string
    mode: 'active' | 'call'
}

/**
 * O atendimento que a clínica começa.
 *
 * Dois sentidos no mesmo lugar: a clínica escreve primeiro, ou o paciente
 * ligou. Diálogo e não painel porque nada aqui depende de ler a conversa ao
 * lado — ela não existe ainda — e porque é o formato que serve igual à lista de
 * conversas e à lista de pacientes.
 *
 * O telefone é a chave da tela, e é por isso que ele é verificado antes de
 * qualquer gravação: um dígito trocado criaria paciente, negócio e cartão no
 * funil para um número que nunca receberia mensagem. Três respostas possíveis —
 * já é paciente, tem WhatsApp, não tem — e cada uma muda a ação do botão em vez
 * de só mostrar um aviso.
 */
export function NewAttendanceDialog({
    open,
    onOpenChange,
    /** Telefone e nome vindos de uma ficha existente (gatilho em Pacientes). */
    initialPhone = '',
    initialName = '',
    onDone,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    initialPhone?: string
    initialName?: string
    onDone: (result: IntakeResult) => void
}) {
    const [mode, setMode] = useState<'active' | 'call'>('active')
    const [phone, setPhone] = useState(initialPhone)
    const [name, setName] = useState(initialName)
    const [originId, setOriginId] = useState('')
    const [channelId, setChannelId] = useState('')
    const [callNotes, setCallNotes] = useState('')
    const [lookup, setLookup] = useState<LookupResult | null>(null)
    const [checking, setChecking] = useState(false)
    const [saving, setSaving] = useState(false)
    const [origins, setOrigins] = useState<Option[]>([])
    const [channels, setChannels] = useState<Option[]>([])

    useEffect(() => {
        if (!open) return
        let cancelled = false
        Promise.all([
            fetch('/api/agencies').then((r) => (r.ok ? r.json() : [])),
            fetch('/api/medias').then((r) => (r.ok ? r.json() : [])),
        ])
            .then(([a, m]) => {
                if (cancelled) return
                setOrigins(Array.isArray(a) ? a : [])
                setChannels(Array.isArray(m) ? m : [])
            })
            .catch(() => { })
        return () => {
            cancelled = true
        }
    }, [open])

    /**
     * A consulta espera a digitação parar.
     *
     * Sem a pausa, cada tecla viraria uma chamada ao provedor de WhatsApp — e a
     * verificação de número é a parte lenta. 500 ms é o tempo em que uma pessoa
     * termina de digitar um telefone.
     */
    useEffect(() => {
        const digits = phone.replace(/\D/g, '')
        if (!open || digits.length < 10) {
            setLookup(null)
            return
        }
        let cancelled = false
        setChecking(true)
        const timer = setTimeout(() => {
            fetch(`/api/contacts/lookup?phone=${encodeURIComponent(digits)}`)
                .then((r) => (r.ok ? r.json() : null))
                .then((data: LookupResult | null) => {
                    if (cancelled) return
                    setLookup(data)
                    setChecking(false)
                    // Nome que já está na ficha não precisa ser digitado de novo.
                    if (data?.existing?.name) setName((prev) => prev || data.existing!.name!)
                })
                .catch(() => {
                    if (!cancelled) {
                        setLookup(null)
                        setChecking(false)
                    }
                })
        }, 500)
        return () => {
            cancelled = true
            clearTimeout(timer)
            setChecking(false)
        }
    }, [phone, open])

    const existing = lookup?.existing ?? null
    const noWhatsApp = lookup?.valid === true && lookup.whatsapp === false && !existing
    const unverified = lookup?.valid === true && lookup.whatsapp === null && !existing

    /** O que o botão faz depende do que o telefone respondeu. */
    const action = useMemo(() => {
        if (mode === 'call') return { label: 'Registrar ligação', icon: Phone }
        if (existing?.conversationId) return { label: 'Abrir a conversa', icon: MessageCircle }
        return { label: 'Abrir conversa', icon: MessageCircle }
    }, [mode, existing])

    const blocked = !lookup?.valid || checking || (mode === 'active' && noWhatsApp)

    const submit = async () => {
        if (blocked) return
        setSaving(true)
        try {
            const res = await fetch('/api/conversations/intake', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode,
                    phone: lookup!.phone,
                    name: name.trim(),
                    originId: originId || null,
                    channelId: channelId || null,
                    callNotes: mode === 'call' ? callNotes.trim() : '',
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(data.error || 'Não foi possível abrir o atendimento')
                return
            }
            onDone(data as IntakeResult)
            onOpenChange(false)
            setPhone('')
            setName('')
            setCallNotes('')
            setOriginId('')
            setChannelId('')
            setLookup(null)
        } catch {
            toast.error('Não foi possível abrir o atendimento')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[420px]">
                <DialogHeader>
                    <DialogTitle>Novo atendimento</DialogTitle>
                    <DialogDescription>
                        {mode === 'active'
                            ? 'O paciente ainda não escreveu? Comece você.'
                            : 'Registre a ligação que acabou de chegar.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* O modo primeiro: é ele que decide se algo será enviado. */}
                    <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                        {([
                            { id: 'active' as const, label: 'WhatsApp', icon: MessageCircle },
                            { id: 'call' as const, label: 'Ligação', icon: Phone },
                        ]).map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                role="tab"
                                aria-selected={mode === option.id}
                                onClick={() => setMode(option.id)}
                                className={cn(
                                    'flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
                                    mode === option.id
                                        ? 'bg-card text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                )}
                            >
                                <option.icon className="size-3.5" />
                                {option.label}
                            </button>
                        ))}
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="intake-phone">Telefone</Label>
                        <div className="relative">
                            <Input
                                id="intake-phone"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="(11) 99999-9999"
                                inputMode="tel"
                                autoComplete="off"
                                className="num pr-9"
                                autoFocus
                            />
                            {checking ? (
                                <Loader2 className="absolute right-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
                            ) : null}
                        </div>

                        {/* Um estado por resposta, e nenhum deles silencioso. */}
                        {existing ? (
                            <div className="flex items-start gap-2 rounded-md bg-success-subtle px-2.5 py-2 text-xs text-success-subtle-foreground">
                                <User className="mt-0.5 size-3.5 shrink-0" />
                                <span>
                                    <strong>{existing.name || 'Paciente cadastrado'}</strong> já está na base
                                    {existing.stageName ? (
                                        <> · negócio em <strong>{existing.stageName}</strong></>
                                    ) : null}
                                    {existing.conversationId ? '. A conversa dele será aberta.' : '.'}
                                </span>
                            </div>
                        ) : noWhatsApp ? (
                            <div className="flex items-start gap-2 rounded-md bg-destructive-subtle px-2.5 py-2 text-xs text-destructive-subtle-foreground">
                                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                                <span>
                                    Este número não tem WhatsApp. Confira os dígitos — ou registre como
                                    <strong> ligação</strong>, que não envia nada.
                                </span>
                            </div>
                        ) : unverified ? (
                            <p className="text-xs text-muted-foreground">
                                Não foi possível verificar o número no WhatsApp agora. Dá para seguir.
                            </p>
                        ) : lookup?.valid ? (
                            <div className="flex items-start gap-2 rounded-md bg-primary-subtle px-2.5 py-2 text-xs text-primary-subtle-foreground">
                                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                                <span>
                                    Tem WhatsApp. Novo na base — será cadastrado ao confirmar.
                                    {/* Quando o WhatsApp endereça o número de outra
                                        forma — sem o nono dígito, por exemplo — a tela
                                        diz qual, em vez de gravar algo diferente do
                                        que a pessoa digitou sem avisar. */}
                                    {lookup.typed && lookup.typed !== lookup.phone ? (
                                        <span className="num block opacity-80">
                                            No WhatsApp ele é {lookup.formatted} — é assim que fica salvo.
                                        </span>
                                    ) : null}
                                </span>
                            </div>
                        ) : phone.replace(/\D/g, '').length >= 10 ? (
                            <p className="text-xs text-destructive-subtle-foreground">
                                Número incompleto. Inclua o DDD.
                            </p>
                        ) : null}
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="intake-name">Nome</Label>
                        <Input
                            id="intake-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Como o paciente se apresentou"
                        />
                        {!name.trim() ? (
                            <p className="text-xs text-muted-foreground">
                                Sem nome, a ficha fica com o número.
                            </p>
                        ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="intake-origin">Origem</Label>
                            <Select value={originId || 'none'} onValueChange={(v) => setOriginId(v === 'none' ? '' : v)}>
                                <SelectTrigger id="intake-origin" className="w-full"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">—</SelectItem>
                                    {origins.map((o) => (
                                        <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="intake-channel">Canal</Label>
                            <Select value={channelId || 'none'} onValueChange={(v) => setChannelId(v === 'none' ? '' : v)}>
                                <SelectTrigger id="intake-channel" className="w-full"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">—</SelectItem>
                                    {channels.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {mode === 'call' ? (
                        <div className="space-y-1.5">
                            <Label htmlFor="intake-notes">O que foi falado</Label>
                            <Textarea
                                id="intake-notes"
                                value={callNotes}
                                onChange={(e) => setCallNotes(e.target.value)}
                                rows={3}
                                placeholder="Procurou por qual procedimento, o que ficou combinado…"
                            />
                            <p className="text-xs text-muted-foreground">
                                Fica como atividade de Ligação e como nota interna na conversa.
                            </p>
                        </div>
                    ) : null}

                    <div className="flex items-start gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
                        <Route className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                            {existing?.dealId
                                ? 'O negócio aberto deste paciente é reaproveitado — nada é duplicado.'
                                : 'Abre um negócio na primeira etapa do funil, como quando o paciente escreve primeiro.'}
                            {mode === 'call' ? ' A fase se marca na Jornada do paciente, que abre em seguida.' : ''}
                        </span>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancelar
                    </Button>
                    <Button onClick={() => void submit()} disabled={blocked || saving} className="gap-2">
                        {saving ? <Loader2 className="size-4 animate-spin" /> : <action.icon className="size-4" />}
                        {action.label}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
