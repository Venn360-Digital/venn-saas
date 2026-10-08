'use client'

import { useCallback, useSyncExternalStore } from 'react'

const KEY = 'odontobox360-sound-enabled'
const EVENT = 'odontobox360-sound-change'

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
    window.addEventListener(EVENT, onChange)
    return () => {
        window.removeEventListener('storage', onChange)
        window.removeEventListener(EVENT, onChange)
    }
}

function getSnapshot(): boolean {
    try {
        return localStorage.getItem(KEY) !== 'false'
    } catch {
        // A private window, or site data blocked: sound on is the better default.
        return true
    }
}

/** Sound is on until someone turns it off, including before hydration. */
const getServerSnapshot = () => true

export function useSoundEnabled(): [boolean, (next: boolean) => void] {
    const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

    const set = useCallback((next: boolean) => {
        try {
            localStorage.setItem(KEY, String(next))
        } catch {
            // Nothing to persist to; the event still updates this session.
        }
        window.dispatchEvent(new CustomEvent(EVENT, { detail: next }))
    }, [])

    return [enabled, set]
}
