'use client'

import { useSyncExternalStore } from 'react'

/**
 * O relógio como store externo.
 *
 * "14 dias nesta fase" depende da hora atual, e a hora atual não é um dado do
 * React: chamar `Date.now()` durante o render é impuro — o valor muda entre
 * dois renders que deveriam ser idênticos, e a regra
 * `react-hooks/purity` acusa com razão.
 *
 * Aqui o tempo entra pelo caminho certo: um store que avisa quem está inscrito.
 * Ganho de lado nada pequeno — o número **se atualiza sozinho**, o que importa
 * num quadro que alguém deixa aberto das 8 às 19.
 *
 * `0` no servidor e na primeira pintura significa "ainda não sei"; quem usa
 * trata isso omitindo o valor, em vez de mostrar um número errado por um quadro.
 */
const TICK = 60_000

let now = 0
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function tick() {
    now = Date.now()
    for (const listener of listeners) listener()
}

function subscribe(onChange: () => void) {
    listeners.add(onChange)
    if (!timer) {
        tick()
        timer = setInterval(tick, TICK)
    }
    return () => {
        listeners.delete(onChange)
        if (listeners.size === 0 && timer) {
            clearInterval(timer)
            timer = null
        }
    }
}

const getSnapshot = () => now
const getServerSnapshot = () => 0

/** Milissegundos desde a época, ou `0` antes de hidratar. */
export function useNow(): number {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
