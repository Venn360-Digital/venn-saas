'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Eye, EyeOff, Loader2, Lock, LogIn, User } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/brand/Logo'
import { cn } from '@/lib/utils'

const MIN = 8

/**
 * O aceite do convite, nas duas faces.
 *
 * **Com senha** quando o e-mail não tem usuário: a pessoa escolhe a senha aqui,
 * e é isso que o convite inteiro existe para permitir — o administrador perdeu
 * esse campo por exigência de LGPD, porque senha é dado de autenticação do
 * titular.
 *
 * **Sem senha** quando o e-mail já tem usuário: a pessoa é de outra unidade da
 * conta ou de outra conta, já tem senha, e o aceite é só o vínculo. Mostrar
 * campo de senha aqui ofereceria trocar a credencial dela em outro lugar.
 *
 * O servidor decide de novo qual face vale — ver a nota da página. Isto aqui é
 * a tela, não a regra.
 */
export function ConviteForm({
    token,
    email,
    papel,
    unidade,
    convidadoPor,
    diasRestantes,
    precisaDeSenha,
    nome: nomeInicial,
    sobrenome: sobrenomeInicial,
}: {
    token: string
    email: string
    papel: string
    unidade: string
    convidadoPor: string | null
    diasRestantes: number
    precisaDeSenha: boolean
    nome: string
    sobrenome: string
}) {
    const [nome, setNome] = useState(nomeInicial)
    const [sobrenome, setSobrenome] = useState(sobrenomeInicial)
    const [senha, setSenha] = useState('')
    const [repetida, setRepetida] = useState('')
    const [mostrar, setMostrar] = useState(false)
    const [enviando, setEnviando] = useState(false)
    const router = useRouter()

    const comprimentoOk = senha.length >= MIN
    const coincidem = repetida.length > 0 && senha === repetida
    const senhaOk = !precisaDeSenha || (comprimentoOk && coincidem)
    const podeEnviar = nome.trim().length > 0 && senhaOk && !enviando

    async function enviar(e: React.FormEvent) {
        e.preventDefault()
        if (!podeEnviar) return
        setEnviando(true)

        try {
            const res = await fetch(`/api/convite/${encodeURIComponent(token)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: nome.trim(),
                    lastName: sobrenome.trim() || undefined,
                    ...(precisaDeSenha ? { password: senha } : {}),
                }),
            })
            const dados = (await res.json().catch(() => null)) as
                | { ok?: true; jaTinhaConta?: boolean; error?: string }
                | null

            if (!res.ok) throw new Error(dados?.error || 'Não foi possível aceitar o convite')

            /**
             * E agora o login — porque o aceite **não** cria sessão.
             *
             * É a mesma decisão da recuperação de senha: a pessoa prova que sabe
             * a senha que acabou de escolher. Entrar direto pareceria mais
             * rápido e deixaria quem recebeu o link num estado em que está
             * autenticado sem nunca ter digitado a senha.
             */
            toast.success(
                dados?.jaTinhaConta
                    ? `Pronto. Entre para acessar ${unidade}.`
                    : 'Senha criada. Entre para começar.'
            )
            router.push(`/login?email=${encodeURIComponent(email)}`)
        } catch (erro) {
            toast.error(
                erro instanceof Error && erro.message
                    ? erro.message
                    : 'Não foi possível aceitar o convite'
            )
            console.error('[CONVITE]', erro)
        } finally {
            setEnviando(false)
        }
    }

    return (
        <div className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
            <div className="w-full max-w-sm">
                <div className="mb-8">
                    <Logo variant="wordmark" height={30} priority />
                </div>

                <h1 className="text-h1">
                    {precisaDeSenha ? 'Criar o seu acesso' : 'Aceitar o convite'}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    {convidadoPor ? (
                        <>
                            <span className="font-medium text-foreground">{convidadoPor}</span> te
                            convidou para {unidade}.
                        </>
                    ) : (
                        <>Você foi convidado para {unidade}.</>
                    )}
                </p>

                {/* Os três fatos do convite, em lista e não em frase: papel e
                    e-mail são o que a pessoa confere antes de aceitar, e dentro
                    de um parágrafo ela teria de caçá-los. O prazo entra aqui
                    porque é o único deles que muda sozinho. */}
                <dl className="my-6 space-y-1.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs">
                    <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">E-mail</dt>
                        <dd className="truncate font-medium">{email}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Acesso</dt>
                        <dd className="font-medium">{papel}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Validade</dt>
                        <dd className="font-medium">
                            {diasRestantes <= 1
                                ? 'expira hoje'
                                : `${diasRestantes} dias restantes`}
                        </dd>
                    </div>
                </dl>

                <form onSubmit={enviar} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label htmlFor="nome">Nome</Label>
                            <div className="relative">
                                <User
                                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                                    aria-hidden="true"
                                />
                                <Input
                                    id="nome"
                                    value={nome}
                                    onChange={(e) => setNome(e.target.value)}
                                    required
                                    maxLength={80}
                                    autoFocus
                                    autoComplete="given-name"
                                    className="pl-9"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="sobrenome">Sobrenome</Label>
                            <Input
                                id="sobrenome"
                                value={sobrenome}
                                onChange={(e) => setSobrenome(e.target.value)}
                                maxLength={80}
                                autoComplete="family-name"
                            />
                        </div>
                    </div>

                    {precisaDeSenha ? (
                        <>
                            <div className="space-y-2">
                                <Label htmlFor="senha">Escolha a sua senha</Label>
                                <div className="relative">
                                    <Lock
                                        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                                        aria-hidden="true"
                                    />
                                    <Input
                                        id="senha"
                                        type={mostrar ? 'text' : 'password'}
                                        value={senha}
                                        onChange={(e) => setSenha(e.target.value)}
                                        required
                                        minLength={MIN}
                                        autoComplete="new-password"
                                        aria-describedby="regra-da-senha"
                                        className="pr-10 pl-9"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setMostrar((v) => !v)}
                                        aria-label={mostrar ? 'Ocultar senha' : 'Mostrar senha'}
                                        className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                    >
                                        {mostrar ? (
                                            <EyeOff className="size-4" />
                                        ) : (
                                            <Eye className="size-4" />
                                        )}
                                    </button>
                                </div>
                                {/* A regra é dita e depois confirmada ao ser
                                    cumprida, em vez de só aparecer como recusa
                                    depois de enviar. Mesmo padrão da tela de
                                    nova senha. */}
                                <p
                                    id="regra-da-senha"
                                    className={cn(
                                        'flex items-center gap-1.5 text-xs',
                                        comprimentoOk
                                            ? 'text-success-subtle-foreground'
                                            : 'text-muted-foreground'
                                    )}
                                >
                                    {comprimentoOk ? <Check className="size-3.5" /> : null}
                                    Mínimo de {MIN} caracteres
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="repetida">Repita a senha</Label>
                                <div className="relative">
                                    <Lock
                                        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                                        aria-hidden="true"
                                    />
                                    <Input
                                        id="repetida"
                                        type={mostrar ? 'text' : 'password'}
                                        value={repetida}
                                        onChange={(e) => setRepetida(e.target.value)}
                                        required
                                        autoComplete="new-password"
                                        aria-invalid={repetida.length > 0 && !coincidem}
                                        className="pl-9"
                                    />
                                </div>
                                {repetida.length > 0 && !coincidem ? (
                                    <p className="text-xs text-destructive-subtle-foreground">
                                        As senhas não coincidem
                                    </p>
                                ) : null}
                            </div>
                        </>
                    ) : (
                        /* Sem campo de senha, a tela tem de dizer por quê — senão
                           parece que faltou um campo. */
                        <p className="rounded-lg border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                            Você já tem acesso com esse e-mail. Aceitar aqui só adiciona{' '}
                            {unidade} ao que você já usa — a sua senha continua a mesma.
                        </p>
                    )}

                    <Button type="submit" className="w-full" disabled={!podeEnviar}>
                        {enviando ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <LogIn className="size-4" />
                        )}
                        {precisaDeSenha ? 'Criar acesso' : 'Aceitar convite'}
                    </Button>
                </form>
            </div>
        </div>
    )
}
