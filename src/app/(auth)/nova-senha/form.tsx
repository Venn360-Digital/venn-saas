'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Eye, EyeOff, Loader2, Lock } from 'lucide-react'
import { toast } from 'sonner'

import { createClient } from '@/lib/supabase/client'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const MIN = 8

export function NovaSenhaForm({ email }: { email: string }) {
    const [password, setPassword] = useState('')
    const [confirmation, setConfirmation] = useState('')
    const [show, setShow] = useState(false)
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    const longEnough = password.length >= MIN
    const matches = confirmation.length > 0 && password === confirmation
    const canSubmit = longEnough && matches && !loading

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!canSubmit) return
        setLoading(true)

        try {
            const supabase = createClient()
            const { error } = await supabase.auth.updateUser({ password })
            if (error) throw error

            toast.success('Senha alterada')
            router.push('/dashboard')
            router.refresh()
        } catch (error) {
            const message = error instanceof Error ? error.message : ''
            if (message.includes('should be different')) {
                toast.error('A nova senha precisa ser diferente da anterior')
            } else {
                toast.error(message || 'Não foi possível alterar a senha')
            }
            console.error('[NOVA_SENHA]', error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
            <div className="w-full max-w-sm">
                <div className="mb-8">
                    <Logo variant="wordmark" height={30} priority />
                </div>

                <h1 className="text-h1">Criar nova senha</h1>
                <p className="mt-1 mb-6 text-sm text-muted-foreground">
                    Escolha a senha de acesso de{' '}
                    <span className="text-foreground">{email}</span>.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="password">Nova senha</Label>
                        <div className="relative">
                            <Lock
                                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                                aria-hidden="true"
                            />
                            <Input
                                id="password"
                                type={show ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                minLength={MIN}
                                autoFocus
                                autoComplete="new-password"
                                aria-describedby="password-rule"
                                className="pr-10 pl-9"
                            />
                            <button
                                type="button"
                                onClick={() => setShow((v) => !v)}
                                aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
                                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                            </button>
                        </div>
                        {/* The rule is stated and then confirmed as it is met, rather
                            than only surfacing as a rejection after submit. */}
                        <p
                            id="password-rule"
                            className={cn(
                                'flex items-center gap-1.5 text-xs',
                                longEnough
                                    ? 'text-success-subtle-foreground'
                                    : 'text-muted-foreground'
                            )}
                        >
                            {longEnough ? <Check className="size-3.5" /> : null}
                            Mínimo de {MIN} caracteres
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="confirmation">Repita a senha</Label>
                        <div className="relative">
                            <Lock
                                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                                aria-hidden="true"
                            />
                            <Input
                                id="confirmation"
                                type={show ? 'text' : 'password'}
                                value={confirmation}
                                onChange={(e) => setConfirmation(e.target.value)}
                                required
                                autoComplete="new-password"
                                aria-invalid={confirmation.length > 0 && !matches}
                                className="pl-9"
                            />
                        </div>
                        {confirmation.length > 0 && !matches ? (
                            <p className="text-xs text-destructive-subtle-foreground">As senhas não coincidem</p>
                        ) : null}
                    </div>

                    <Button type="submit" className="w-full" disabled={!canSubmit}>
                        {loading ? <Loader2 className="animate-spin" /> : null}
                        Salvar e entrar
                    </Button>
                </form>
            </div>
        </div>
    )
}
