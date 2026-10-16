'use client'

import { useCallback, useEffect, useState } from 'react'
import { Instagram, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { useFacebookSdk } from '@/components/agents/creation/useFacebookSdk'

/**
 * O botão que liga o Instagram da clínica, sem ninguém tocar em token.
 *
 * A clínica clica, autoriza numa janela da Meta, e pronto. O que volta para cá é
 * um **código de poucos segundos** — não um token —, e ele vai direto ao
 * servidor, que faz a sequência inteira. A chave secreta do aplicativo nunca
 * esteve aqui, e o token da clínica nunca chega a existir no navegador.
 *
 * Mais simples que o do WhatsApp, e isto não é descuido: no Instagram não há
 * número para registrar, nem PIN, nem modelo de mensagem a aprovar. É consentir
 * e começar a atender.
 *
 * **A segunda janela.** Quando a clínica tem mais de uma Página com Instagram,
 * o servidor devolve as opções e o login é repetido com a escolha. Parece
 * estranho repetir, e é o preço de não guardar o token em lugar nenhum enquanto
 * alguém decide — a segunda janela não pergunta nada, porque o consentimento já
 * foi dado.
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
                // O aviso da chave invisível fica na tela: é o que faz a
                // diferença entre conectado e funcionando, e ninguém volta
                // depois para ler um toast de três segundos.
                if (corpo?.aviso) toast.warning(corpo.aviso, { duration: 30_000 })
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

    if (!appId || !configId) {
        return (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                Não configurado
            </span>
        )
    }

    if (!canManage) {
        return (
            <span className="text-[11px] text-muted-foreground">Só o administrador conecta</span>
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

    if (conta?.connected) {
        return (
            <>
                <div className="flex items-center gap-2">
                    <span className="rounded-full bg-success-subtle px-2 py-0.5 text-[10px] font-semibold text-success-subtle-foreground">
                        {conta.username ? `@${conta.username}` : 'No ar'}
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
            </>
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
}
