'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { PaginaDeIndice } from '../lib/indice'

/**
 * A metade de cliente do índice: nasce com os dados do servidor e só busca
 * quando o recorte muda de verdade.
 *
 * **Por que isto é um hook e não um trecho copiado.** O guarda que impede a
 * busca na montagem é a peça mais fácil de errar do padrão inteiro, e eu errei
 * duas vezes antes de chegar nesta forma:
 *
 * 1. Buscar na montagem "só para garantir" refaz a consulta que o servidor
 *    acabou de fazer e repinta a tabela logo depois de ela aparecer — o
 *    defeito que a mudança veio remover.
 * 2. Um `useRef(true)` gasto na primeira execução morre no StrictMode, que
 *    roda o efeito duas vezes: a primeira gasta o guarda, a segunda busca.
 *
 * A forma correta é **comparar o recorte servido**, não contar visitas: o ref
 * guarda a chave do recorte que já está na tela, e o efeito só busca quando a
 * chave muda. Rodar N vezes com a mesma chave não dispara nada. Com cinco
 * cópias disso à mão, a sexta tela erraria de novo; com uma implementação só,
 * não há onde errar.
 *
 * **O que fica fora daqui, de propósito:** a consulta e os parâmetros. A tela
 * continua dona de página, busca e filtros — ela é que sabe o que lista. Este
 * hook é dono do *disciplinamento*: semear, guardar, buscar e expor o estado.
 */
export function useIndiceServidor<T>({
    inicial,
    recorte,
    buscar,
}: {
    /** O que o servidor entregou. Semeia a primeira pintura. */
    inicial: PaginaDeIndice<T>
    /**
     * Uma chave que identifica o recorte atual (página, limite, busca,
     * filtros). **Na primeira renderização ela precisa descrever o mesmo
     * recorte que o servidor serviu** — é esse casamento que faz a montagem
     * não buscar. Se a tela semear a página 1 mas montar a chave com a página
     * 2, o hook busca de imediato, e com razão.
     */
    recorte: string
    /** Busca o recorte atual. Chamada só quando a chave muda, ou por `recarregar`. */
    buscar: () => Promise<PaginaDeIndice<T> | null>
}) {
    const [itens, setItens] = useState<T[]>(inicial.itens)
    const [total, setTotal] = useState(inicial.total)
    const [totalPages, setTotalPages] = useState(inicial.totalPages)
    /**
     * Nasce `false`: os dados já estão na tela. Era `true` e essa única linha
     * era metade do pisca — a tela montava anunciando espera que não existia.
     */
    const [carregando, setCarregando] = useState(false)

    /**
     * A chave do recorte que já está na tela. Começa valendo o recorte da
     * primeira renderização, que é o que o servidor serviu.
     */
    const servido = useRef(recorte)

    /**
     * `buscar` fica num ref para a identidade dela não mexer no efeito.
     *
     * Ela quase sempre é um `useCallback` da tela, e qualquer dependência que
     * mude recria a função. Se ela entrasse nas dependências do efeito, uma
     * troca de identidade dispararia busca **sem o recorte ter mudado** — o
     * mesmo repinte, entrando por outra porta.
     */
    const buscarRef = useRef(buscar)
    // Atualizado em efeito, não durante a renderização (`react-hooks/refs`), e
    // **declarado antes** do efeito principal: efeitos rodam na ordem em que
    // são declarados, então quando o recorte e a função mudam no mesmo render,
    // o principal já encontra a versão nova.
    useEffect(() => {
        buscarRef.current = buscar
    })

    const aplicar = useCallback((pagina: PaginaDeIndice<T> | null) => {
        if (!pagina) return
        setItens(pagina.itens)
        setTotal(pagina.total)
        setTotalPages(pagina.totalPages)
    }, [])

    /**
     * Relê o recorte atual **sem passar pelo guarda** — é o que as telas
     * chamam depois de gravar ou excluir, quando os dados em mãos ficaram
     * velhos e a chave do recorte não mudou.
     */
    const recarregar = useCallback(async () => {
        setCarregando(true)
        try {
            aplicar(await buscarRef.current())
        } finally {
            setCarregando(false)
        }
    }, [aplicar])

    useEffect(() => {
        if (servido.current === recorte) return
        servido.current = recorte

        // `vivo` evita escrever estado de uma resposta que chegou depois de a
        // tela já ter trocado de recorte — a corrida clássica de lista
        // filtrada, em que a resposta velha sobrescreve a nova.
        let vivo = true

        const executar = async () => {
            setCarregando(true)
            try {
                const pagina = await buscarRef.current()
                if (vivo) aplicar(pagina)
            } finally {
                if (vivo) setCarregando(false)
            }
        }
        void executar()

        return () => {
            vivo = false
        }
    }, [recorte, aplicar])

    return { itens, setItens, total, totalPages, carregando, recarregar }
}
