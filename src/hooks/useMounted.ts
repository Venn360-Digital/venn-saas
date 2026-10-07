'use client'

import { useSyncExternalStore } from 'react'

/** Nunca emite: o valor nunca muda depois da hidratação. */
const subscribe = () => () => {}
const getSnapshot = () => true
const getServerSnapshot = () => false

/**
 * `false` no servidor e na primeira pintura, `true` depois de hidratar.
 *
 * Substitui o par `useState(false)` + `useEffect(() => setMounted(true), [])`,
 * que é o jeito tradicional de esperar a hidratação e é exatamente o que a regra
 * `react-hooks/set-state-in-effect` acusa: um setState disparado por efeito
 * agenda um segundo render para dizer algo que o React já sabia.
 *
 * `useSyncExternalStore` com um `getServerSnapshot` diferente do snapshot do
 * cliente é a forma própria de perguntar "já hidratou?" — sem estado, sem
 * efeito, e com o React tratando a diferença entre servidor e cliente como parte
 * do protocolo em vez de como uma correção depois do fato.
 */
export function useMounted(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
