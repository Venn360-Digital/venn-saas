'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Eye, EyeOff, Loader2, Lock, Save } from 'lucide-react'
import { toast } from 'sonner'

import { resetPassword } from '@venn/core/lib/auth/cliente'
import { Logo } from '@venn/core/components/brand/Logo'
import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { cn } from '@venn/ui/utils'

const MIN = 8

export function NovaSenhaForm({ token }: { token: string }) {
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
            /**
             * O token vem da URL e é gasto aqui.
             *
             * Uma chamada só: trocar o token pela senha nova. Não há sessão
             * antes disto — ver a nota da página —, então a pessoa precisa
             * entrar depois, e é para o login que ela vai.
             */
            const { error } = await resetPassword({ newPassword: password, token })
            if (error) throw Object.assign(new Error(error.message), { code: error.code })

            toast.success('Senha alterada. Entre com a nova senha.')
            router.push('/login')
        } catch (error) {
            const codigo = (error as { code?: string })?.code
            if (codigo === 'INVALID_TOKEN') {
                toast.error('O link de recuperação expirou ou já foi usado. Peça outro.')
            } else if (codigo === 'PASSWORD_TOO_SHORT') {
                toast.error(`A senha precisa de pelo menos ${MIN} caracteres.`)
            } else {
                toast.error(
                    error instanceof Error && error.message
                        ? error.message
                        : 'Não foi possível alterar a senha'
                )
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
                    Escolha a senha de acesso da conta do e-mail que você acabou de abrir.
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
                        {loading ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        Salvar e entrar
                    </Button>
                </form>
            </div>
        </div>
    )
}
