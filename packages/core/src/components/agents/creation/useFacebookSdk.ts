'use client'

import { useEffect, useState } from 'react'

/**
 * O SDK do Facebook, carregado **uma vez** para quantos botões existirem.
 *
 * Existe por um defeito concreto: cada botão carregava o script por conta
 * própria e, achando a tag já no documento, desistia sem nunca marcar-se como
 * pronto. Com um botão só isso nunca apareceu; com dois na mesma tela — WhatsApp
 * oficial e Instagram —, o segundo a montar ficava desabilitado para sempre, sem
 * erro e sem explicação.
 *
 * A promessa no escopo do módulo é o que resolve: quem chega depois aguarda a
 * mesma carga em vez de iniciar outra, e `FB.init` roda uma vez só.
 */

declare global {
    interface Window {
        FB?: {
            init: (options: Record<string, unknown>) => void
            login: (
                callback: (resposta: { authResponse?: { code?: string } }) => void,
                options: Record<string, unknown>
            ) => void
        }
    }
}

const SDK_ID = 'facebook-jssdk'
const SDK_SRC = 'https://connect.facebook.net/pt_BR/sdk.js'

/** A versão da Graph que o SDK usa. A mesma do servidor, de propósito. */
const VERSION = 'v23.0'

let carga: Promise<void> | null = null

function carregar(appId: string): Promise<void> {
    if (carga) return carga

    carga = new Promise<void>((resolve, reject) => {
        const iniciar = () => {
            window.FB?.init({ appId, cookie: true, xfbml: false, version: VERSION })
            resolve()
        }

        if (window.FB) {
            iniciar()
            return
        }

        const existente = document.getElementById(SDK_ID) as HTMLScriptElement | null
        if (existente) {
            // Tag já no documento e script ainda em voo: esperar o `load` dela é
            // o que faltava antes — desistir aqui era o defeito.
            existente.addEventListener('load', iniciar, { once: true })
            existente.addEventListener('error', () => reject(new Error('SDK não carregou')), {
                once: true,
            })
            return
        }

        const script = document.createElement('script')
        script.id = SDK_ID
        script.src = SDK_SRC
        script.async = true
        script.crossOrigin = 'anonymous'
        script.onload = iniciar
        script.onerror = () => reject(new Error('SDK não carregou'))
        document.body.appendChild(script)
    }).catch((erro) => {
        // Uma falha de rede não pode trancar a carga para sempre: a próxima
        // montagem tenta de novo.
        carga = null
        throw erro
    })

    return carga
}

export function useFacebookSdk(appId: string | null | undefined): boolean {
    const [pronto, setPronto] = useState(false)

    useEffect(() => {
        if (!appId) return
        let vivo = true
        carregar(appId)
            .then(() => {
                if (vivo) setPronto(true)
            })
            .catch(() => undefined)
        return () => {
            vivo = false
        }
    }, [appId])

    return pronto
}
