'use client'

import { useCallback, useEffect, useState } from 'react'
import { Instagram, Loader2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SettingsRow } from '@/components/shared/TabsFrame'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { useFacebookSdk } from '@/components/agents/creation/useFacebookSdk'

/**
 * O cartão que liga o Instagram da clínica — botão e orientação juntos.
 *
 * A clínica clica, autoriza numa janela da Meta, e pronto. O que volta para cá é
 * um **código de poucos segundos** — não um token —, e ele vai direto ao
 * servidor, que faz a sequência inteira. A chave secreta do aplicativo nunca
 * esteve aqui, e o token da clínica nunca chega a existir no navegador.
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

interface Candidato {
    pageId: string
    pageName: string
    igAccountId: string
    username: string | null
}

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
    const [appId, setAppId] = useState<string | null>(null)
    const [configId, setConfigId] = useState<string | null>(null)
    const [conta, setConta] = useState<Conta | null>(null)
    const [carregando, setCarregando] = useState(false)
    const [candidatos, setCandidatos] = useState<Candidato[] | null>(null)
    const [escolha, setEscolha] = useState<string>('')
    const [aDesligar, setADesligar] = useState(false)

    const sdkPronto = useFacebookSdk(appId)

    useEffect(() => {
        fetch('/api/integrations/meta/config')
            .then((r) => r.json())
            .then((d) => {
                if (!d.configured) return
                setAppId(d.appId ?? null)
                setConfigId(d.instagramConfigId ?? null)
            })
            .catch(() => undefined)
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

    const enviar = useCallback(
        async (code: string, pageId?: string) => {
            setCarregando(true)
            try {
                const res = await fetch(`/api/agents/${agentId}/integrations/instagram`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code, pageId }),
                })
                const corpo = await res.json().catch(() => null)

                if (!res.ok) {
                    toast.error(corpo?.error ?? 'Não foi possível conectar o Instagram.')
                    return
                }

                if (corpo?.needsChoice) {
                    setCandidatos(corpo.candidates ?? [])
                    setEscolha(corpo.candidates?.[0]?.pageId ?? '')
                    return
                }

                setCandidatos(null)
                toast.success(
                    corpo?.username
                        ? `Instagram @${corpo.username} conectado.`
                        : 'Instagram conectado.'
                )
                void carregarConta()
            } catch {
                toast.error('Não foi possível conectar o Instagram.')
            } finally {
                setCarregando(false)
            }
        },
        [agentId, carregarConta]
    )

    const abrir = useCallback(
        (pageId?: string) => {
            if (!window.FB || !configId) return

            window.FB.login(
                (resposta) => {
                    const code = resposta?.authResponse?.code
                    if (!code) {
                        toast.info('Conexão cancelada.')
                        return
                    }
                    void enviar(code, pageId)
                },
                {
                    config_id: configId,
                    response_type: 'code',
                    override_default_response_type: true,
                }
            )
        },
        [configId, enviar]
    )

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

    /** O botão, o seletor de conta ou o estado — o que couber no momento. */
    const acao = (() => {
        if (!appId || !configId) {
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

        if (candidatos && candidatos.length > 0) {
            return (
                <div className="flex items-center gap-2">
                    <Select value={escolha} onValueChange={setEscolha}>
                        <SelectTrigger className="h-8 w-56 text-xs">
                            <SelectValue placeholder="Escolha a conta" />
                        </SelectTrigger>
                        <SelectContent>
                            {candidatos.map((c) => (
                                <SelectItem key={c.pageId} value={c.pageId}>
                                    {c.username ? `@${c.username}` : c.pageName}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        size="sm"
                        className="h-8"
                        disabled={!escolha || carregando}
                        onClick={() => abrir(escolha)}
                    >
                        {carregando ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                            'Confirmar'
                        )}
                    </Button>
                </div>
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
                disabled={!sdkPronto || carregando}
                onClick={() => abrir()}
            >
                {carregando ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                    <Instagram className="size-3.5" aria-hidden="true" />
                )}
                {carregando ? 'Conectando…' : 'Conectar'}
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
            {canManage && appId && configId ? conectado ? <LembreteDeAcesso /> : <Preparos /> : null}

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
