'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { useArmazenamento } from './useArmazenamento'

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
/** Sound is on until someone turns it off, including before hydration. */
const getServerSnapshot = () => true

export function useSoundEnabled(): [boolean, (next: boolean) => void] {
    const armazenamento = useArmazenamento()

    /**
     * `subscribe` e `getSnapshot` saem do hook, e não do módulo, porque agora
     * dependem do prefixo da marca — e o `useSyncExternalStore` reinscreve
     * quando a identidade de `subscribe` muda, então as duas têm de ser
     * estáveis. `useArmazenamento` já é memoizado pelo `slug`, o que faz esta
     * dependência mudar nunca na prática.
     */
    const { subscribe, getSnapshot } = useMemo(() => {
        const nomeDoEvento = armazenamento.evento(NOME_DO_EVENTO)
        return {
            subscribe: (onChange: () => void) => {
                // `storage` fires for other tabs; the custom event for this one.
                window.addEventListener('storage', onChange)
                window.addEventListener(nomeDoEvento, onChange)
                return () => {
                    window.removeEventListener('storage', onChange)
                    window.removeEventListener(nomeDoEvento, onChange)
                }
            },
            // `ler` já engole a exceção de janela privativa e devolve null: som
            // ligado é o melhor padrão para quem nunca escolheu.
            getSnapshot: () => armazenamento.ler(NOME, [CHAVE_ANTIGA]) !== 'false',
        }
    }, [armazenamento])

    const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

    const set = useCallback(
        (next: boolean) => {
            armazenamento.escrever(NOME, String(next))
            window.dispatchEvent(
                new CustomEvent(armazenamento.evento(NOME_DO_EVENTO), { detail: next })
            )
        },
        [armazenamento]
    )

    return [enabled, set]
}
