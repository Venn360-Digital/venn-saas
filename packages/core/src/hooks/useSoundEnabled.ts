'use client'

import { useCallback, useSyncExternalStore } from 'react'

import { chave, escrever, evento, ler } from '../lib/armazenamento'

/**
 * A chave que já existe no navegador de quem usa o produto hoje.
 *
 * Passa para `ler()` como nome antigo: na primeira leitura depois do deploy o
 * valor é migrado para a chave nova e esta é removida. Sem isso, **o som
 * voltaria a ligado para todo mundo que o desligou** — não quebra nada, e é
 * exatamente o tipo de perda que ninguém reporta como bug.
 */
const CHAVE_ANTIGA = 'odontobox360-sound-enabled'
const NOME = 'som'
const NOME_DO_EVENTO = 'som-mudou'

/**
 * Whether the notification sound is on, shared across the app.
 *
 * It lives in `localStorage` and is read by two places at once — the topbar's
 * toggle and the inbox, which decides whether to play on an inbound message.
 * Each of them had its own copy of "read the key, listen for the event", and the
 * topbar's copy was a `useState` + `useEffect` that read storage after mount:
 * a setState scheduled by an effect to tell React something that was already
 * knowable, which is exactly what `react-hooks/set-state-in-effect` is for.
 *
 * `useSyncExternalStore` is the right tool because `localStorage` *is* an
 * external store: the server snapshot is the default, the client snapshot is the
 * stored value, and React treats the difference as part of the protocol rather
 * than as something to patch up after the first paint.
 */
function subscribe(onChange: () => void) {
    // `storage` fires for other tabs; the custom event for this one.
    window.addEventListener('storage', onChange)
    window.addEventListener(evento(NOME_DO_EVENTO), onChange)
    return () => {
        window.removeEventListener('storage', onChange)
        window.removeEventListener(evento(NOME_DO_EVENTO), onChange)
    }
}

function getSnapshot(): boolean {
    // `ler` já engole a exceção de janela privativa e devolve null: som ligado
    // é o melhor padrão para quem nunca escolheu.
    return ler(NOME, [CHAVE_ANTIGA]) !== 'false'
}

/** Sound is on until someone turns it off, including before hydration. */
const getServerSnapshot = () => true

export function useSoundEnabled(): [boolean, (next: boolean) => void] {
    const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

    const set = useCallback((next: boolean) => {
        escrever(NOME, String(next))
        window.dispatchEvent(new CustomEvent(evento(NOME_DO_EVENTO), { detail: next }))
    }, [])

    return [enabled, set]
}
