'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Loader2, Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react'

function LoginForm() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [isSignUp, setIsSignUp] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const router = useRouter()
    const searchParams = useSearchParams()

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

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)

        try {
            const supabase = createClient()

            if (isSignUp) {
                // Sign Up
                const { data, error } = await supabase.auth.signUp({
                    email,
                    password,
                })

                if (error) throw error

                toast.success('Conta criada! Verifique seu email para confirmar.')
                setIsSignUp(false)
            } else {
                // Sign In
                const { data, error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                })

                if (error) throw error

                // Check if user has a workspace via API (bypasses RLS issues)
                const checkRes = await fetch('/api/auth/check-workspace')
                const checkData = await checkRes.json()

                toast.success('Login realizado com sucesso!')

                if (!checkData.hasWorkspace) {
                    // Onboarding comes first regardless of where they were headed.
                    router.push('/onboarding')
                } else {
                    router.push(redirectTo)
                }

                router.refresh()
            }
        } catch (error: any) {
            // Handle specific Supabase auth errors
            if (error.message?.includes('Invalid login credentials')) {
                toast.error('Credenciais inválidas. Verifique seu email e senha ou crie uma conta.')
            } else if (error.message?.includes('Email not confirmed')) {
                toast.error('Email não confirmado. Verifique sua caixa de entrada.')
            } else {
                toast.error(error.message || 'Erro ao autenticar')
            }
            console.error(error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0a0f] p-4">
            {/* Background gradient effects */}
            <div className="pointer-events-none absolute inset-0">
                {/* Purple aurora in top-right corner */}
                <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-purple-600/20 blur-[128px]" />
                {/* Subtle blue glow in bottom-left */}
                <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-indigo-600/10 blur-[128px]" />
            </div>

            {/* Content */}
            <div className="relative z-10 w-full max-w-md">
                {/* Logo */}
                <div className="mb-8 flex flex-col items-center">
                    <img
                        src="/images/logo_night.png"
                        alt="Kaly AI Agent"
                        className="h-[80px] w-auto"
                    />
                </div>

                {/* Welcome text */}
                <div className="mb-8 text-center">
                    <h1 className="text-2xl font-semibold text-white">
                        {isSignUp ? 'Criar Conta' : 'Bem-vindo de volta'}
                    </h1>
                    <p className="mt-2 text-sm text-gray-400">
                        {isSignUp
                            ? 'Crie sua conta para começar'
                            : 'Entre na sua conta para continuar'
                        }
                    </p>
                </div>

                {/* Login Card */}
                <div className="rounded-xl border border-white/10 bg-[#12121a]/80 p-6 backdrop-blur-sm">
                    <div className="mb-4">
                        <h2 className="text-lg font-medium text-white">Login</h2>
                        <p className="text-sm text-gray-400">
                            Use seu email e senha para acessar
                        </p>
                    </div>

                    <form onSubmit={handleAuth} className="space-y-4">
                        {/* Email Field */}
                        <div className="space-y-2">
                            <Label htmlFor="email" className="text-sm text-gray-300">
                                Email
                            </Label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="seu@email.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    disabled={loading}
                                    className="border-white/10 bg-white/5 pl-10 text-white placeholder:text-gray-500 focus:border-purple-500/50 focus:ring-purple-500/20"
                                />
                            </div>
                        </div>

                        {/* Password Field */}
                        <div className="space-y-2">
                            <Label htmlFor="password" className="text-sm text-gray-300">
                                Senha
                            </Label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                                <Input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="Digite sua senha"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    disabled={loading}
                                    minLength={6}
                                    className="border-white/10 bg-white/5 pl-10 pr-10 text-white placeholder:text-gray-500 focus:border-purple-500/50 focus:ring-purple-500/20"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                                >
                                    {showPassword ? (
                                        <EyeOff className="h-4 w-4" />
                                    ) : (
                                        <Eye className="h-4 w-4" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Submit Button */}
                        <Button
                            type="submit"
                            className="w-full bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-700 hover:to-purple-600"
                            disabled={loading}
                        >
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isSignUp ? 'Criar Conta' : 'Entrar'}
                            {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                        </Button>
                    </form>

                    {/* Divider */}
                    <div className="my-6 flex items-center gap-3">
                        <div className="h-px flex-1 bg-white/10" />
                        <span className="text-xs text-gray-500">OU</span>
                        <div className="h-px flex-1 bg-white/10" />
                    </div>

                    {/* Google Button */}
                    <Button
                        type="button"
                        variant="outline"
                        className="w-full border-white/10 bg-transparent text-white hover:bg-white/5"
                        disabled={loading}
                    >
                        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                            <path
                                fill="currentColor"
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            />
                            <path
                                fill="currentColor"
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            />
                            <path
                                fill="currentColor"
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                            />
                            <path
                                fill="currentColor"
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                            />
                        </svg>
                        Continuar com Google
                    </Button>

                    {/* Sign Up Link */}
                    <div className="mt-6 text-center">
                        <button
                            type="button"
                            onClick={() => setIsSignUp(!isSignUp)}
                            className="text-sm text-gray-400 hover:text-white"
                            disabled={loading}
                        >
                            {isSignUp ? (
                                <>Já tem uma conta? <span className="text-purple-400">Fazer login</span></>
                            ) : (
                                <>Não tem uma conta? <span className="text-purple-400">Criar conta</span></>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginForm />
        </Suspense>
    )
}
