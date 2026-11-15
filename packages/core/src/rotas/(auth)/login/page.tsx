'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react'
import { toast } from 'sonner'

import { requestPasswordReset, signIn, signUp } from '@venn/core/lib/auth/cliente'
import { Logo } from '@venn/core/components/brand/Logo'
import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@venn/ui/tabs'
import { useVocab } from '../../../hooks/useVocab'
import { comArtigo } from '../../../lib/concordancia'

function LoginForm() {
    const v = useVocab()
    /**
     * `?email=` pré-preenche — quem vem do aceite do convite acabou de digitar
     * este endereço, e pedir de novo na tela seguinte é atrito sem razão.
     *
     * Vem do `useSearchParams` e não de `localStorage`: é dado de um fluxo, não
     * preferência. E não há risco de vazar conta alheia — o valor já está na
     * barra de endereço de quem o pôs lá.
     */
    const [email, setEmail] = useState(() => '')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [resetting, setResetting] = useState(false)
    const [mode, setMode] = useState<'signin' | 'signup'>('signin')
    const [showPassword, setShowPassword] = useState(false)
    const router = useRouter()
    const searchParams = useSearchParams()

    const isSignUp = mode === 'signup'

    const emailDaUrl = searchParams.get('email')
    useEffect(() => {
        if (emailDaUrl) setEmail(emailDaUrl)
    }, [emailDaUrl])

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

    /**
     * Traduz o código de erro do Better Auth.
     *
     * Por **código**, não por trecho de mensagem. O jeito antigo comparava
     * `message.includes('Invalid login credentials')`, que é o texto em inglês
     * de um fornecedor — ele muda de versão sem avisar, e quando muda a tela
     * cai no ramo genérico e passa a mostrar a frase do fornecedor ao usuário.
     */
    function mensagemDe(codigo: string | undefined, fallback: string | undefined): string {
        switch (codigo) {
            case 'INVALID_EMAIL_OR_PASSWORD':
                return 'E-mail ou senha incorretos. Confira e tente de novo.'
            case 'USER_ALREADY_EXISTS':
                return 'Esse e-mail já tem conta. Entre em vez de criar.'
            case 'PASSWORD_TOO_SHORT':
                return 'A senha precisa de pelo menos 8 caracteres.'
            case 'EMAIL_NOT_VERIFIED':
                return 'Confirme seu e-mail pelo link que enviamos antes de entrar.'
            /**
             * O erro que custou uma hora de diagnóstico em 2026-11-09.
             *
             * O host de homologação não estava em `hostsPermitidos()`, então
             * todo `sign-in` do navegador voltava 403 `INVALID_ORIGIN` — e,
             * sem este `case`, a tela dizia "Não foi possível continuar", que
             * é exatamente a frase que não ajuda ninguém. O conserto da lista
             * é o que resolve; este `case` é o que faz a próxima vez se
             * anunciar.
             */
            case 'INVALID_ORIGIN':
                return 'Este endereço não está autorizado a entrar. Avise quem cuida do sistema — a origem precisa ser liberada.'
            default:
                return fallback || 'Não foi possível continuar'
        }
    }

    async function handleAuth(e: React.FormEvent) {
        e.preventDefault()
        setLoading(true)

        try {
            if (isSignUp) {
                const { error } = await signUp.email({
                    email,
                    password,
                    /**
                     * O nome vem do e-mail, por ora.
                     *
                     * O formulário não pede nome e o onboarding pede logo em
                     * seguida — então um palpite aqui vale mais que um campo a
                     * mais numa tela que já tem dois. É o mesmo palpite que a
                     * aplicação já fazia ao semear a linha de `users`.
                     */
                    name: email.split('@')[0] || email,
                })

                if (error) throw Object.assign(new Error(error.message), { code: error.code })

                /**
                 * Cadastrar **já entra**.
                 *
                 * O Better Auth emite a sessão no próprio cadastro, e a
                 * confirmação de e-mail não é exigida neste corte. Então não há
                 * mais o passo de "confirme pelo link e depois entre" que o
                 * GoTrue impunha — e mandar a pessoa de volta para a aba de
                 * entrar, como antes, seria pedir que ela fizesse login numa
                 * sessão que já está aberta.
                 */
                window.location.assign('/onboarding')
                return
            }

            const { error } = await signIn.email({ email, password })
            if (error) throw Object.assign(new Error(error.message), { code: error.code })

            // Checked through the API, which uses Prisma: the membership table
            // is only ever read server-side.
            const checkRes = await fetch('/api/auth/check-workspace')
            const checkData = await checkRes.json()

            if (!checkData.hasWorkspace) {
                // Onboarding comes first regardless of where they were headed.
                // Recarga inteira, não `router.push`: ver o comentário
                // logo abaixo, no caminho normal.
                window.location.assign('/onboarding')
            } else {
                /**
                 * Entrar recarrega a página inteira.
                 *
                 * `router.push` é navegação de cliente: o módulo JS da aba
                 * sobrevive — com o cache da conta anterior dentro — e o
                 * Router Cache do Next pode reusar o RSC do layout do
                 * dashboard, que carrega **dados do usuário** desde a
                 * correção do primeiro paint. Numa aba onde outra pessoa
                 * esteve logada, isso mostra a conta dela.
                 *
                 * A aba reiniciar no login custa um recarregamento numa
                 * ação que acontece uma vez por dia.
                 */
                window.location.assign(redirectTo)
            }

            router.refresh()
        } catch (error) {
            const codigo = (error as { code?: string })?.code
            const message = error instanceof Error ? error.message : ''
            toast.error(mensagemDe(codigo, message))
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
            const { error } = await requestPasswordReset({
                email,
                /**
                 * A tela que recebe o token, não a que a pessoa queria.
                 *
                 * O caminho antigo mandava para `/auth/callback`, que era do
                 * GoTrue e trocava um `?code=` por sessão. O Better Auth manda o
                 * token direto no link, e quem o troca por senha nova é
                 * `/nova-senha`.
                 */
                redirectTo: `${window.location.origin}/nova-senha`,
            })
            if (error) throw error

            /**
             * A mensagem não revela se o e-mail tem conta.
             *
             * "Enviado, confira seu e-mail" para um endereço que não existe é
             * uma resposta deliberadamente igual à do que existe: a diferença
             * entre as duas transformaria esta tela num verificador de quem é
             * cliente da clínica.
             */
            toast.success('Se esse e-mail tiver conta, o link de recuperação chegou.')
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
                    <span className="mb-5 block h-0.5 w-12 rounded-full bg-brand-mint" />
                    <h2 className="text-display text-brand-navy-foreground">
                        OdontoBox360. A nova inteligência da gestão odontológica.
                    </h2>
                    <p className="mt-4 text-sm leading-relaxed text-brand-navy-muted">
                        Atendimento com IA, qualificação, agendamento, vendas e histórico
                        {comArtigo(v, 'pessoa', 'de')} no mesmo lugar. Da recepção ao financeiro.
                    </p>
                </div>

                <p className="relative z-10 text-center text-xs text-brand-navy-muted/70">
                    Uma solução{' '}
                    <a
                        href="https://venn360.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-navy-muted underline underline-offset-2 hover:text-brand-navy-foreground"
                    >
                        Venn360
                    </a>
                    {' · '}
                    {/* A política precisa ser alcançável sem login — é
                        requisito do Google para publicar o consentimento OAuth,
                        e um link daqui é o caminho que um revisor segue. */}
                    <a
                        href="/privacidade"
                        className="text-brand-navy-muted underline underline-offset-2 hover:text-brand-navy-foreground"
                    >
                        Privacidade
                    </a>
                </p>
            </aside>

            {/* Form */}
            <main className="flex w-full flex-col items-center justify-center bg-background px-4 py-10 lg:w-1/2">
                <div className="w-full max-w-sm">
                    <div className="mb-8">
                        <Logo variant="wordmark" height={90} priority />
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
                                    placeholder="nome@exemplo.com.br"
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

                    {/* O botão do Google que ficava aqui não tinha `onClick`
                        nenhum, e foi removido em vez de ficar como controle que
                        não faz nada. Ligá-lo hoje é configurar o provedor social
                        no Better Auth — o motivo antigo citava o provedor anterior,
                        que saiu na migração. */}
                </div>
            </main>
        </div>
    )
}

export default function LoginPage() {
    /**
     * **O fallback não desenha campo falso.** `fallback={null}`, e não um
     * esqueleto — conserto de 2026-11-09, terceira vez que o Andre reclama da
     * "sombra de campos" (ver `useEsperaLonga` e DESIGN.md §5).
     *
     * Aqui era o pior caso dos três: o esqueleto eram cinco blocos cinza na
     * forma do título, da legenda, dos dois campos e do botão — e, porque esta
     * página é renderizada no servidor, eles vinham **no HTML da primeira
     * pintura**. Não havia limiar que os evitasse: `useEsperaLonga` é um
     * `useEffect`, e o fallback de `Suspense` é desenhado antes de qualquer
     * efeito rodar. Então quem entrava e quem saía — as duas ações fazem
     * `window.location.assign`, recarga inteira — via a sombra toda vez.
     *
     * A fronteira continua obrigatória: `LoginForm` usa `useSearchParams`, e
     * sem ela o Next recusa a página. O que muda é o que ela mostra enquanto
     * espera: nada, que é o que `conta/page.tsx` e `pagamento/retorno` já
     * fazem. A espera é a hidratação do próprio bundle — abaixo do limiar que
     * ninguém percebe, e nenhuma promessa de campo que ainda não está lá.
     */
    return (
        <Suspense fallback={null}>
            <LoginForm />
        </Suspense>
    )
}
