'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BadgeCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { useFacebookSdk } from './useFacebookSdk'

/**
 * O botão que liga o WhatsApp oficial da clínica, sem ninguém tocar em token.
 *
 * A clínica clica, escolhe o número dela numa janela da própria Meta, e pronto.
 * O que volta para cá é um **código de trinta segundos** — não um token —, e ele
 * é mandado direto para o servidor, que faz a sequência inteira. O segredo do
 * aplicativo nunca esteve aqui, e o token da clínica nunca chega a existir no
 * navegador.
 *
 * **Duas respostas chegam por caminhos diferentes, e precisamos das duas:**
 *
 * - o `code`, pelo retorno do `FB.login`;
 * - o `waba_id` e o `phone_number_id`, por um `postMessage` que a janela manda.
 *
 * Elas não chegam na mesma ordem sempre, então o envio ao servidor só acontece
 * quando as duas existem. Esperar só uma delas é o erro clássico desta
 * integração — e os trinta segundos do código não perdoam uma segunda tentativa.
 */

interface Props {
    agentId: string
    onConectado: () => void
    /**
     * Quem desenha o gatilho, quando não é o botão padrão.
     *
     * A guia Canais passou a ter **uma chave** para todos os canais
     * (2026-10-20), e um botão "Conectar" no meio delas quebraria o padrão.
     * Em vez de um `comoChave?: boolean` que só esta tela usaria, o componente
     * entrega o que sabe — abrir, se está ocupado, se o SDK já veio — e deixa
     * a tela desenhar. O que ele guarda para si é o fluxo da Meta.
     */
    trigger?: (estado: { abrir: () => void; ocupado: boolean; pronto: boolean }) => React.ReactNode
}

export function MetaEmbeddedSignup({ agentId, onConectado, trigger }: Props) {
    const [config, setConfig] = useState<{ appId: string; configId: string } | null>(null)
    const [carregando, setCarregando] = useState(false)

    /**
     * O SDK vem do carregador compartilhado.
     *
     * Antes cada botão carregava o script por conta própria e, achando a tag já
     * no documento, desistia sem se marcar como pronto — o que deixava o segundo
     * botão da tela desabilitado para sempre. Ver `useFacebookSdk`.
     */
    const sdkPronto = useFacebookSdk(config?.appId)

    /**
     * Os dois pedaços da resposta, guardados fora do estado do React.
     *
     * Se fossem estado, o retorno do `FB.login` leria o valor do render em que
     * foi criado — e o `postMessage` quase sempre chega depois. O `ref` é lido
     * no instante do uso, que é o que esta corrida exige.
     */
    const pedacos = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string }>({})

    useEffect(() => {
        fetch('/api/integrations/meta/config')
            .then((r) => r.json())
            .then((d) => {
                // `configId` nulo é o caso de o aplicativo existir e a
                // configuração do WhatsApp ainda não — o botão então diz "não
                // configurado" em vez de abrir uma janela que falha.
                if (d.configured && d.configId) setConfig({ appId: d.appId, configId: d.configId })
            })
            .catch(() => undefined)
    }, [])

    const enviarQuandoCompleto = useCallback(async () => {
        const { code, wabaId, phoneNumberId } = pedacos.current
        if (!code || !wabaId || !phoneNumberId) return

        // Zera antes de enviar: um segundo `postMessage` não pode disparar um
        // segundo POST com o mesmo código, que já teria sido consumido.
        pedacos.current = {}
        setCarregando(true)

        try {
            const res = await fetch(`/api/agents/${agentId}/integrations/meta`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, wabaId, phoneNumberId }),
            })
            const corpo = await res.json().catch(() => null)

            if (!res.ok) {
                toast.error(corpo?.error ?? 'Não foi possível conectar o número.')
                return
            }

            toast.success(
                corpo?.jaEstavaRegistrado
                    ? 'Número conectado. Ele já estava registrado na Meta, e isso é esperado.'
                    : 'Número conectado.'
            )
            onConectado()
        } catch {
            toast.error('Não foi possível conectar o número.')
        } finally {
            setCarregando(false)
        }
    }, [agentId, onConectado])

    // A janela da Meta manda os ids por `postMessage`, não pelo retorno.
    useEffect(() => {
        const aoReceber = (evento: MessageEvent) => {
            if (!evento.origin.endsWith('facebook.com')) return
            try {
                const dados = JSON.parse(evento.data)
                if (dados.type !== 'WA_EMBEDDED_SIGNUP') return
                if (dados.event === 'FINISH' || dados.event === 'FINISH_ONLY_WABA') {
                    pedacos.current.wabaId = dados.data?.waba_id
                    pedacos.current.phoneNumberId = dados.data?.phone_number_id
                    void enviarQuandoCompleto()
                }
                if (dados.event === 'CANCEL') {
                    pedacos.current = {}
                    toast.info('Conexão cancelada.')
                }
            } catch {
                // Mensagem que não é do fluxo. O Facebook manda várias.
            }
        }

        window.addEventListener('message', aoReceber)
        return () => window.removeEventListener('message', aoReceber)
    }, [enviarQuandoCompleto])

    const abrir = () => {
        if (!window.FB || !config) return
        pedacos.current = {}

        window.FB.login(
            (resposta) => {
                const code = resposta?.authResponse?.code
                if (!code) {
                    toast.info('Conexão cancelada.')
                    return
                }
                pedacos.current.code = code
                void enviarQuandoCompleto()
            },
            {
                config_id: config.configId,
                response_type: 'code',
                override_default_response_type: true,
                // É este parâmetro que abre o fluxo do WhatsApp, e não a
                // variação escolhida no painel — lá só existia "Geral".
                extras: { feature: 'whatsapp_embedded_signup', sessionInfoVersion: '3' },
            }
        )
    }

    if (!config) {
        return (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                Não configurado
            </span>
        )
    }

    if (trigger) return <>{trigger({ abrir, ocupado: carregando, pronto: sdkPronto })}</>

    return (
        <Button size="sm" className="h-8 gap-1.5" onClick={abrir} disabled={!sdkPronto || carregando}>
            {carregando ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
                <BadgeCheck className="size-3.5" aria-hidden="true" />
            )}
            {carregando ? 'Conectando…' : 'Conectar'}
        </Button>
    )
}
