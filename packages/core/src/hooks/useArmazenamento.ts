'use client'

import { useMemo } from 'react'

import { useMarca } from '../marca-contexto'
import { chave, escrever, evento, ler, remover } from '../lib/armazenamento'

/**
 * As chaves do navegador, já prefixadas pela marca desta sessão.
 *
 * `lib/armazenamento` é puro de propósito: o prefixo entra por parâmetro
 * porque no navegador **ninguém registrou a marca** — o registro de módulo é
 * avaliado só no servidor (raiz do App Router) e no Worker. Este hook é a
 * ponte: tira o `slug` do `ProvedorDeMarca`, que a raiz garante em toda tela,
 * e devolve as funções já ligadas.
 *
 * ## Por que `useMemo`
 *
 * `useSoundEnabled` passa `subscribe` e `getSnapshot` para
 * `useSyncExternalStore`, que **reinscreve quando a identidade de `subscribe`
 * muda**. Sem memo, cada render criaria funções novas e o React removeria e
 * registraria o ouvinte a cada quadro. O `slug` não muda durante a vida da
 * página, então a dependência é estável na prática — o memo é o que torna isso
 * verdade para o React também.
 */
export interface Armazenamento {
    chave: (nome: string) => string
    evento: (nome: string) => string
    ler: (nome: string, antigas?: string[]) => string | null
    escrever: (nome: string, valor: string) => void
    remover: (nome: string, antigas?: string[]) => void
}

export function useArmazenamento(): Armazenamento {
    const { slug } = useMarca()
    return useMemo(
        () => ({
            chave: (nome) => chave(slug, nome),
            evento: (nome) => evento(slug, nome),
            ler: (nome, antigas) => ler(slug, nome, antigas),
            escrever: (nome, valor) => escrever(slug, nome, valor),
            remover: (nome, antigas) => remover(slug, nome, antigas),
        }),
        [slug]
    )
}
