'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface ProviderRow {
    provider: string
    label: string
    help: string
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
        } catch { /* a seção simplesmente não aparece */ }
    }

    useEffect(() => { void load() }, [])

    if (!visible || !rows) return null

    const save = async (provider: string) => {
        if (!clientId.trim() || !clientSecret.trim()) {
            toast.error('Informe o Client ID e o Client Secret')
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
        <section className="mt-4 max-w-5xl rounded-xl border border-border bg-card p-5">
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
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {row.configured && row.clientId ? row.clientId : row.help}
                                </p>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    setOpen(open === row.provider ? null : row.provider)
                                    setClientId(row.clientId ?? '')
                                    setClientSecret('')
                                }}
                            >
                                {row.configured ? 'Alterar' : 'Registrar'}
                            </Button>
                        </div>

                        {open === row.provider ? (
                            <div className={cn('mt-3 space-y-3 rounded-lg bg-muted/40 p-3')}>
                                <div className="space-y-1">
                                    <Label htmlFor={`${row.provider}-id`} className="text-xs">Client ID</Label>
                                    <Input
                                        id={`${row.provider}-id`}
                                        value={clientId}
                                        onChange={(e) => setClientId(e.target.value)}
                                        autoComplete="off"
                                        className="text-xs"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor={`${row.provider}-secret`} className="text-xs">Client Secret</Label>
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
                                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
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
