'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Save, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface ProviderRow {
    provider: string
    label: string
    help: string
    /** Como o provedor chama suas credenciais. "Client ID" é só o padrão. */
    idLabel?: string
    secretLabel?: string
    /** Provedor cujas duas metades são segredo — o Asaas. Nenhuma volta para cá. */
    segredoDuplo?: boolean
    /** "sandbox" | "producao", derivado do prefixo da chave. Só com segredo duplo. */
    ambiente?: string | null
    configured: boolean
    clientId: string | null
    updatedAt: string | null
}

/**
 * The application registrations every clinic connects through.
 *
 * Visible only to the OWNER of the platform workspace. A clinic never sees this:
 * it opens Integrações, clicks "Conectar", picks its account and is done — which
 * only works because the application is registered once, here.
 */
export function PlatformCredentialsPanel() {
    const [rows, setRows] = useState<ProviderRow[] | null>(null)
    /**
     * O estado da fila de webhooks do Asaas.
     *
     * Fica aqui porque é aqui que a chave dele é administrada — e porque é a
     * única informação desta integração que não dá sintoma em lugar nenhum: a
     * fila deles para depois de 15 falhas seguidas e os eventos somem em
     * silêncio.
     */
    const [webhookDoAsaas, setWebhookDoAsaas] = useState<{
        ok: boolean
        problemas: string[]
    } | null>(null)
    const [visible, setVisible] = useState(false)
    const [open, setOpen] = useState<string | null>(null)
    const [clientId, setClientId] = useState('')
    const [clientSecret, setClientSecret] = useState('')
    const [saving, setSaving] = useState(false)

    const load = async () => {
        try {
            const res = await fetch('/api/platform/credentials')
            if (!res.ok) return
            const data = await res.json()
            setVisible(Boolean(data.isPlatformAdmin))
            setRows(data.providers ?? [])
            setWebhookDoAsaas(data.asaasWebhook ?? null)
        } catch { /* a seção simplesmente não aparece */ }
    }

    useEffect(() => { void load() }, [])

    if (!visible || !rows) return null

    const save = async (provider: string) => {
        if (!clientId.trim() || !clientSecret.trim()) {
            toast.error('Preencha os dois campos')
            return
        }
        setSaving(true)
        try {
            const res = await fetch('/api/platform/credentials', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
            })
            const data = await res.json()
            if (!res.ok) {
                toast.error(data.error || 'Não foi possível salvar')
                return
            }
            toast.success('Credenciais da plataforma salvas')
            setOpen(null)
            setClientId('')
            setClientSecret('')
            await load()
        } catch {
            toast.error('Não foi possível salvar')
        } finally {
            setSaving(false)
        }
    }

    return (
        <section className="max-w-5xl rounded-xl border border-border bg-card p-5">
            <div className="mb-1 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h2 className="text-h4">Aplicativos da plataforma</h2>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
                Registrados uma vez e usados por todas as clínicas. Com isso, conectar uma
                clínica é escolher a conta e autorizar — ninguém precisa criar projeto no
                Google Cloud nem mexer no servidor.
            </p>

            <ul className="divide-y divide-border rounded-lg border border-border">
                {rows.map((row) => (
                    <li key={row.provider} className="p-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="flex items-center gap-2 text-sm font-medium">
                                    {row.label}
                                    {row.configured ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[10px] font-semibold text-success-subtle-foreground">
                                            <Check className="h-3 w-3" />registrado
                                        </span>
                                    ) : (
                                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                            pendente
                                        </span>
                                    )}
                                </p>
                                {/* O id registrado cabe numa linha; a ajuda é
                                    um caminho de menu e precisa quebrar, ou o
                                    "…" come justamente o fim, que é onde está
                                    a tela certa. */}
                                <p
                                    className={cn(
                                        'mt-0.5 text-xs text-muted-foreground',
                                        row.configured && row.clientId
                                            ? 'truncate'
                                            : 'leading-relaxed'
                                    )}
                                >
                                    {row.configured && row.clientId
                                        ? row.clientId
                                        : /* Com segredo duplo não há id para
                                             mostrar — a chave é segredo. O que
                                             vale dizer é o ambiente, porque
                                             cobrar de verdade num teste é o erro
                                             caro desta tela. */
                                          row.configured && row.segredoDuplo
                                          ? row.ambiente === 'producao'
                                              ? 'Chave de PRODUÇÃO — cobra de verdade.'
                                              : 'Chave de sandbox — nada é cobrado.'
                                          : row.help}
                                </p>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    setOpen(open === row.provider ? null : row.provider)
                                    // Com segredo duplo o campo nasce vazio:
                                    // não há o que pré-preencher, e mostrar a
                                    // chave de novo seria tirá-la do cofre para
                                    // nada.
                                    setClientId(row.segredoDuplo ? '' : row.clientId ?? '')
                                    setClientSecret('')
                                }}
                            >
                                {row.configured ? 'Alterar' : 'Registrar'}
                            </Button>
                        </div>

                        {/* A fila do Asaas, na linha do Asaas. */}
                        {row.provider === 'asaas' && webhookDoAsaas && !webhookDoAsaas.ok ? (
                            <div className="mt-2 rounded-md bg-destructive-subtle px-3 py-2">
                                <p className="text-[11px] font-semibold text-destructive-subtle-foreground">
                                    A fila de webhooks precisa de atenção
                                </p>
                                <ul className="mt-1 space-y-0.5">
                                    {webhookDoAsaas.problemas.map((problema) => (
                                        <li
                                            key={problema}
                                            className="text-[11px] leading-snug text-destructive-subtle-foreground"
                                        >
                                            {problema}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        {row.provider === 'asaas' && webhookDoAsaas?.ok ? (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                                Fila de webhooks saudável — nenhuma entrega penalizada.
                            </p>
                        ) : null}

                        {open === row.provider ? (
                            <div className={cn('mt-3 space-y-3 rounded-lg bg-muted/40 p-3')}>
                                <div className="space-y-1">
                                    <Label htmlFor={`${row.provider}-id`} className="text-xs">
                                        {row.idLabel ?? 'Client ID'}
                                    </Label>
                                    <Input
                                        id={`${row.provider}-id`}
                                        // Segredo duplo esconde também o primeiro
                                        // campo: ali está a chave que move
                                        // dinheiro, e ela não se lê de relance
                                        // por cima do ombro de ninguém.
                                        type={row.segredoDuplo ? 'password' : 'text'}
                                        value={clientId}
                                        onChange={(e) => setClientId(e.target.value)}
                                        autoComplete="off"
                                        className="text-xs"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor={`${row.provider}-secret`} className="text-xs">
                                        {row.secretLabel ?? 'Client Secret'}
                                    </Label>
                                    <Input
                                        id={`${row.provider}-secret`}
                                        type="password"
                                        value={clientSecret}
                                        onChange={(e) => setClientSecret(e.target.value)}
                                        placeholder={row.configured ? 'Informe para substituir' : ''}
                                        autoComplete="off"
                                        className="text-xs"
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={() => void save(row.provider)} disabled={saving} className="gap-2">
                                        {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                                        Salvar
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Cancelar</Button>
                                </div>
                            </div>
                        ) : null}
                    </li>
                ))}
            </ul>
        </section>
    )
}
