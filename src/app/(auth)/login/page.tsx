'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react'
import { toast } from 'sonner'

import { createClient } from '@/lib/supabase/client'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'

function LoginForm() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [resetting, setResetting] = useState(false)
    const [mode, setMode] = useState<'signin' | 'signup'>('signin')
    const [showPassword, setShowPassword] = useState(false)
    const router = useRouter()
    const searchParams = useSearchParams()

    const isSignUp = mode === 'signup'

    /**
     * Where to land after signing in. The middleware puts the blocked path in
     * `redirectTo`, so a user who followed a deep link is returned to it instead
     * of being dropped on the dashboard.
     *
     * Only same-origin paths are accepted: an attacker-supplied absolute URL here
     * would turn the login screen into an open redirect.
     */
    const redirectTo = (() => {
        const raw = searchParams.get('redirectTo')
        if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard'
        return raw
    })()

    /**
     * Surface the reason an auth link failed.
     *
     * /auth/callback redirects here with ?error=… when a confirmation or recovery
     * link is invalid or expired. Without this the visitor just sees a normal login
     * form and has no idea the link did not work.
     */
    useEffect(() => {
        const message = searchParams.get('error')
        if (message) toast.error(message)
    }, [searchParams])

    async function handleAuth(e: React.FormEvent) {
        e.preventDefault()
        setLoading(true)

        try {
            const supabase = createClient()

            if (isSignUp) {
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        // Without this GoTrue falls back to SITE_URL, which has no
                        // handler for the `?code=` it appends — the account would be
                        // confirmed while the visitor landed logged out.
                        emailRedirectTo: `${window.location.origin}/auth/callback`,
                    },
                })

                if (error) throw error

                toast.success('Conta criada. Confirme pelo link que enviamos por e-mail.')
                setMode('signin')
            } else {
                const { error } = await supabase.auth.signInWithPassword({ email, password })
                if (error) throw error

                // Checked through the API, which uses Prisma and so is not subject
                // to RLS on the membership table.
                const checkRes = await fetch('/api/auth/check-workspace')
                const checkData = await checkRes.json()

                if (!checkData.hasWorkspace) {
                    // Onboarding comes first regardless of where they were headed.
                    router.push('/onboarding')
                } else {
                    router.push(redirectTo)
                }

                router.refresh()
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : ''
            if (message.includes('Invalid login credentials')) {
                toast.error('E-mail ou senha incorretos. Confira e tente de novo.')
            } else if (message.includes('Email not confirmed')) {
                toast.error('Confirme seu e-mail pelo link que enviamos antes de entrar.')
            } else if (message.includes('User already registered')) {
                toast.error('Esse e-mail já tem conta. Entre em vez de criar.')
            } else {
                toast.error(message || 'Não foi possível continuar')
            }
            console.error('[LOGIN]', error)
        } finally {
            setLoading(false)
        }
    }

    async function handleResetPassword() {
        if (!email) {
            toast.error('Informe seu e-mail para receber o link')
            return
        }
        setResetting(true)
        try {
            const supabase = createClient()
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/auth/callback?next=/gerenciamento/conta`,
            })
            if (error) throw error
            toast.success('Link de recuperação enviado. Confira seu e-mail.')
        } catch (error) {
            console.error('[LOGIN] reset', error)
            toast.error('Não foi possível enviar o link')
        } finally {
            setResetting(false)
        }
    }

    return (
        <div className="flex min-h-svh">
            {/* Brand panel. Navy in both themes, which is why the logo asks for the
                dark artwork explicitly rather than following the theme. */}
            <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-brand-navy p-10 lg:flex">
                {/* The only ornament. The previous screen had two 128px-blur aurora
                    blobs, which is the stock dark-SaaS look and says nothing about
                    a dental clinic. */}
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-32 -right-24 size-[28rem] rounded-full"
                    style={{
                        background:
                            'radial-gradient(circle, color-mix(in srgb, var(--primary) 18%, transparent) 0%, transparent 70%)',
                    }}
                />

                {/* Spacer, so justify-between lands the headline in the middle
                    rather than at the top now that the panel carries no logo. */}
                <div aria-hidden="true" />

                <div className="relative z-10 max-w-sm">
                    <span className="mb-5 block h-0.5 w-12 rounded-full bg-brand-accent" />
                    <h2 className="text-display text-brand-navy-foreground">
                        A clínica inteira numa conversa só
                    </h2>
                    <p className="mt-4 text-sm leading-relaxed text-brand-navy-muted">
                        Atendimento, agenda e histórico do paciente no mesmo lugar — para
                        a recepção não precisar abrir cinco telas por ligação.
                    </p>
                </div>

                <p className="relative z-10 text-xs text-brand-navy-muted/70">
                    uma solução Venn360
                </p>
            </aside>

            {/* Form */}
            <main className="flex w-full flex-col items-center justify-center bg-background px-4 py-10 lg:w-1/2">
                <div className="w-full max-w-sm">
                    <div className="mb-8">
                        <Logo variant="wordmark" height={30} priority />
                    </div>

                    <h1 className="text-h1">
                        {isSignUp ? 'Criar conta' : 'Bem-vindo de volta'}
                    </h1>
                    <p className="mt-1 mb-6 text-sm text-muted-foreground">
                        {isSignUp
                            ? 'Leva um minuto. Você confirma por e-mail e já começa.'
                            : 'Entre para continuar seus atendimentos.'}
                    </p>

                    <Tabs
                        value={mode}
                        onValueChange={(v) => setMode(v as 'signin' | 'signup')}
                        className="mb-6"
                    >
                        <TabsList className="w-full">
                            <TabsTrigger value="signin" className="flex-1">
                                Entrar
                            </TabsTrigger>
                            <TabsTrigger value="signup" className="flex-1">
                                Criar conta
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <form onSubmit={handleAuth} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">E-mail</Label>
                            <div className="relative">
                                <Mail
                                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                                    aria-hidden="true"
                                />
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="nome@clinica.com.br"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    disabled={loading}
                                    autoComplete="email"
                                    className="pl-9"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="password">Senha</Label>
                                {!isSignUp ? (
                                    <button
                                        type="button"
                                        onClick={handleResetPassword}
                                        disabled={resetting}
                                        className="text-xs text-primary hover:underline disabled:opacity-60"
                                    >
                                        {resetting ? 'Enviando…' : 'Esqueci minha senha'}
                                    </button>
                                ) : null}
                            </div>
                            <div className="relative">
                                <Lock
                                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                                    aria-hidden="true"
                                />
                                <Input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="Sua senha"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    minLength={8}
                                    disabled={loading}
                                    autoComplete={
                                        isSignUp ? 'new-password' : 'current-password'
                                    }
                                    // The eight-character minimum was enforced but never
                                    // shown, so a short password read as the form
                                    // silently refusing.
                                    aria-describedby={isSignUp ? 'password-hint' : undefined}
                                    className="pr-10 pl-9"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                    {showPassword ? (
                                        <EyeOff className="size-4" />
                                    ) : (
                                        <Eye className="size-4" />
                                    )}
                                </button>
                            </div>
                            {isSignUp ? (
                                <p id="password-hint" className="text-xs text-muted-foreground">
                                    Mínimo de 8 caracteres.
                                </p>
                            ) : null}
                        </div>

                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? <Loader2 className="animate-spin" /> : null}
                            {isSignUp ? 'Criar conta' : 'Entrar'}
                        </Button>
                    </form>

                    {/* The Google button that used to sit here had no onClick at all.
                        Wiring it needs the provider configured in Supabase Auth, so
                        it is removed rather than left as a control that does
                        nothing. */}
                </div>
            </main>
        </div>
    )
}

export default function LoginPage() {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-svh items-center justify-center bg-background p-4">
                    <div className="w-full max-w-sm space-y-4">
                        <Skeleton className="h-8 w-40" />
                        <Skeleton className="h-4 w-56" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-9 w-full" />
                    </div>
                </div>
            }
        >
            <LoginForm />
        </Suspense>
    )
}
