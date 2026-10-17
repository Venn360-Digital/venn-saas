'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Instagram, Loader2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SettingsRow } from '@/components/shared/TabsFrame'

/**
 * O cartão que liga o Instagram da clínica — botão e orientação juntos.
 *
 * A clínica clica, autoriza numa janela da Meta, e volta. O código nem passa por
 * este componente: a Meta devolve o navegador direto ao nosso callback, que faz
 * a sequência inteira do lado do servidor. A chave secreta do aplicativo nunca
 * esteve aqui, e o token da clínica nunca chega a existir no navegador.
 *
 * **Por que redirecionamento e não o SDK do Facebook.** A primeira versão usava
 * `FB.login` e a Meta recusou a troca do código: ela exige que o `redirect_uri`
 * seja idêntico ao que abriu o diálogo, e pelo SDK esse endereço é escolhido
 * pelo próprio SDK. Com redirecionamento o endereço é nosso nas duas pontas.
 *
 * **Por que o componente desenha o cartão todo, e não só o botão.** Dois
 * preparos acontecem fora daqui, no aplicativo do Instagram, e sem eles o
 * clique não tem como dar certo. Eles precisam estar à vista **antes** do
 * clique, e precisam sumir depois — ou seja, dependem do estado da conexão, que
 * mora neste componente. Deixá-los na aba obrigaria a levantar esse estado só
 * para escolher um texto.
 *
 * Antes isto era um aviso de trinta segundos **depois** de conectar: a hora
 * errada (o preparo é anterior) e o lugar errado (some sozinho). O segundo
 * preparo, em especial, é o que não dá erro nenhum quando está faltando — a
 * conexão fica verde e nada sai —, então ele continua à vista mesmo depois de
 * conectado.
 */

interface Conta {
    connected: boolean
    label?: string | null
    username?: string | null
    status?: string
}

interface Props {
    agentId: string
    canManage: boolean
}

/**
 * Os dois preparos, no aplicativo do Instagram.
 *
 * Numerados porque são mesmo uma sequência: sem conta profissional ligada a uma
 * Página não há o que conectar, e sem a chave de mensagens a conexão não serve
 * para nada. A numeração aqui diz algo verdadeiro sobre o conteúdo, não é
 * enfeite.
 */
function Preparos() {
    return (
        <div className="rounded-md border border-border bg-muted/40 p-3.5">
            <p className="text-[12px] font-semibold">
                Antes de conectar, no aplicativo do Instagram
            </p>

            <ol className="mt-3 flex flex-col gap-3.5">
                <Passo numero={1} titulo="Deixe a conta profissional e ligada a uma Página do Facebook.">
                    <Caminho>
                        Configurações e atividade → Tipo de conta e ferramentas → Mudar para
                        conta profissional
                    </Caminho>
                    No mesmo lugar, vincule a conta a uma Página. É esse vínculo que mantém a
                    conexão válida sem precisar refazer de tempos em tempos.
                </Passo>

                <Passo numero={2} titulo="Permita o acesso às mensagens.">
                    <Caminho>
                        Configurações e atividade → Mensagens e respostas de story → Controles de
                        mensagens → Ferramentas conectadas → Permitir acesso a mensagens
                    </Caminho>
                    Autorizar aqui no OdontoBox360{' '}
                    <strong className="font-semibold text-foreground">não</strong> liga essa
                    chave. Com ela desligada, a conexão aparece como ligada e nenhuma mensagem é
                    enviada.
                </Passo>
            </ol>
        </div>
    )
}

/** Um preparo: o número, o que fazer, onde fazer, e por quê. */
function Passo({
    numero,
    titulo,
    children,
}: {
    numero: number
    titulo: string
    children: React.ReactNode
}) {
    return (
        <li className="flex gap-2.5">
            <span
                className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-background text-[10px] font-bold text-muted-foreground ring-1 ring-border"
                aria-hidden="true"
            >
                {numero}
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold leading-relaxed">{titulo}</p>
                <div className="text-xs leading-relaxed text-muted-foreground">{children}</div>
            </div>
        </li>
    )
}

/**
 * O caminho de menu, em linha própria.
 *
 * Separado do texto porque é de outra natureza: a frase diz o que fazer, o
 * caminho diz onde. Com a mesma aparência dos dois, o olho não separa um do
 * outro e o caminho — que é o que a pessoa vai seguir de celular na mão —
 * some no meio da explicação.
 */
function Caminho({ children }: { children: React.ReactNode }) {
    return (
        <span className="my-1 block rounded border border-border bg-background px-2 py-1.5 font-medium text-foreground">
            {children}
        </span>
    )
}

/**
 * O lembrete que sobrevive à conexão.
 *
 * A chave de acesso a mensagens é a única coisa deste fluxo que falha em
 * silêncio: tudo fica verde e os envios somem. Como não há como conferi-la de
 * fora — ela não aparece em painel nenhum —, o lembrete fica.
 */
function LembreteDeAcesso() {
    return (
        <div className="flex gap-2.5 rounded-md bg-warning-subtle p-3 text-warning-subtle-foreground">
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            <p className="text-xs leading-relaxed">
                <span className="font-semibold">Se as mensagens não chegarem</span>, confira no
                aplicativo do Instagram: Configurações e atividade → Mensagens e respostas de
                story → Controles de mensagens → Ferramentas conectadas → Permitir acesso a
                mensagens. É a única configuração que, desligada, deixa tudo com aparência de
                funcionando.
            </p>
        </div>
    )
}

export function InstagramConnect({ agentId, canManage }: Props) {
    const [configurado, setConfigurado] = useState<boolean | null>(null)
    const [conta, setConta] = useState<Conta | null>(null)
    const [carregando, setCarregando] = useState(false)
    const [aDesligar, setADesligar] = useState(false)

    const router = useRouter()
    const searchParams = useSearchParams()

    useEffect(() => {
        fetch('/api/integrations/meta/config')
            .then((r) => r.json())
            .then((d) => setConfigurado(Boolean(d.configured && d.instagramConfigId)))
            .catch(() => setConfigurado(false))
    }, [])

    const carregarConta = useCallback(async () => {
        try {
            const res = await fetch(`/api/agents/${agentId}/integrations/instagram`)
            if (!res.ok) return
            setConta(await res.json())
        } catch {
            // A tela mostra "desligado" e o botão continua clicável.
        }
    }, [agentId])

    useEffect(() => {
        void carregarConta()
    }, [carregarConta])

    /**
     * Leva a pessoa ao diálogo da Meta.
     *
     * `window.location.href` e não uma janela nova: o fluxo volta por
     * redirecionamento, e um popup bloqueado deixaria a clínica olhando para
     * uma tela que não faz nada. Sair da página é honesto — ela volta.
     */
    const conectar = useCallback(async () => {
        setCarregando(true)
        try {
            const res = await fetch(
                `/api/integrations/instagram/authorize?agentId=${encodeURIComponent(agentId)}`
            )
            const corpo = await res.json().catch(() => null)

            if (!res.ok || !corpo?.authUrl) {
                toast.error(corpo?.error ?? 'Não foi possível abrir a janela da Meta.')
                setCarregando(false)
                return
            }

            window.location.href = corpo.authUrl
        } catch {
            toast.error('Não foi possível abrir a janela da Meta.')
            setCarregando(false)
        }
    }, [agentId])

    const desligar = useCallback(async () => {
        setCarregando(true)
        try {
            const res = await fetch(`/api/agents/${agentId}/integrations/instagram`, {
                method: 'DELETE',
            })
            if (!res.ok) {
                const corpo = await res.json().catch(() => null)
                toast.error(corpo?.error ?? 'Não foi possível desligar.')
                return
            }
            toast.success('Instagram desligado.')
            setConta({ connected: false })
        } finally {
            setCarregando(false)
        }
    }, [agentId])

    const conectado = Boolean(conta?.connected)

    /**
     * O resultado da volta da Meta, que chega pela URL.
     *
     * O callback redireciona para cá com `instagram_ok` ou `instagram_erro`. O
     * parâmetro é limpo depois de lido, com `replace`: sem isso, recarregar a
     * página repetiria o aviso de uma conexão feita há meia hora.
     */
    useEffect(() => {
        const ok = searchParams.get('instagram_ok')
        const erro = searchParams.get('instagram_erro')
        if (!ok && !erro) return

        if (ok) {
            toast.success(ok.startsWith('@') ? `Instagram ${ok} conectado.` : ok)
            void carregarConta()
        } else if (erro) {
            // Longo de propósito: estas mensagens dizem o que fazer, e um aviso
            // de três segundos não daria tempo de ler o caminho de menu.
            toast.error(erro, { duration: 15_000 })
        }

        const limpos = new URLSearchParams(searchParams.toString())
        limpos.delete('instagram_ok')
        limpos.delete('instagram_erro')
        router.replace(`?${limpos.toString()}`, { scroll: false })
    }, [searchParams, router, carregarConta])

    /** O botão ou o estado — o que couber no momento. */
    const acao = (() => {
        if (configurado === false) {
            return (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    Não configurado
                </span>
            )
        }

        if (!canManage) {
            return (
                <span className="text-[11px] text-muted-foreground">
                    Só o administrador conecta
                </span>
            )
        }

        if (conectado) {
            return (
                <div className="flex items-center gap-2">
                    <span className="rounded-full bg-success-subtle px-2 py-0.5 text-[10px] font-semibold text-success-subtle-foreground">
                        {conta?.username ? `@${conta.username}` : 'No ar'}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={carregando}
                        onClick={() => setADesligar(true)}
                    >
                        Desligar
                    </Button>
                </div>
            )
        }

        return (
            <Button
                size="sm"
                className="h-8 gap-1.5"
                disabled={configurado === null || carregando}
                onClick={() => void conectar()}
            >
                {carregando ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                    <Instagram className="size-3.5" aria-hidden="true" />
                )}
                {carregando ? 'Abrindo a Meta…' : 'Conectar'}
            </Button>
        )
    })()

    return (
        <div className="flex flex-col gap-4">
            <SettingsRow
                title={
                    <span className="flex items-center gap-2">
                        <Instagram className="size-4 text-muted-foreground" aria-hidden="true" />
                        Conectar pela Meta
                    </span>
                }
                description="A clínica escolhe a própria conta numa janela da Meta. Nenhuma credencial passa por aqui."
                action={acao}
            />

            {/* O preparo só interessa a quem ainda vai conectar, e só a quem
                pode — para o atendente é informação sobre um botão que ele não
                tem. Depois de conectado sobra o lembrete da chave que falha
                calada. */}
            {canManage && configurado ? conectado ? <LembreteDeAcesso /> : <Preparos /> : null}

            <ConfirmDialog
                open={aDesligar}
                onOpenChange={setADesligar}
                title="Desligar o Instagram?"
                description={
                    'O Direct para de chegar na hora. As conversas e o histórico ficam, e ' +
                    'religar não pede nada ao paciente. A clínica continua respondendo pelo ' +
                    'aplicativo do Instagram normalmente.'
                }
                confirmLabel="Desligar"
                cancelLabel="Manter ligado"
                destructive
                onConfirm={desligar}
            />
        </div>
    )
}
