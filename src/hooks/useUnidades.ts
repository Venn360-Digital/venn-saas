'use client'

import { useEffect, useState } from 'react'

/** Avisa quem desenha a marca e o seletor que a conta ou a unidade mudou. */
export const WORKSPACE_UPDATED = 'workspace:updated'

export interface Unidade {
    id: string
    name: string
}

export interface UnidadeAberta {
    /** A unidade da sessão. */
    id: string | null
    name: string | null
    /** A logomarca **da conta** — é ela que desenha o cabeçalho. */
    logo: string | null
    conta: string | null
    /** Todas as unidades de que esta pessoa participa, da mais antiga à nova. */
    unidades: Unidade[]
}

const VAZIO: UnidadeAberta = { id: null, name: null, logo: null, conta: null, unidades: [] }

/**
 * Quem sou e onde estou, buscado **uma vez** por carregamento de página.
 *
 * Dois componentes precisam disto em toda tela — a marca da sidebar (pela logo)
 * e o seletor do cabeçalho (pela lista) — e cada um com o seu `fetch` fazia duas
 * idas ao servidor por navegação para a mesma resposta. O cache é de módulo: o
 * primeiro que monta busca, o segundo recebe o mesmo objeto.
 *
 * `WORKSPACE_UPDATED` invalida e refaz, para que gravar o nome ou a logo na guia
 * Conta da Clínica apareça no cabeçalho sem recarregar a página.
 *
 * Não é um cache com validade: a resposta vale pelo tempo da página. Trocar de
 * unidade recarrega tudo (de propósito — ver `ClinicBrand`), e aí o cache nasce
 * de novo junto com o resto.
 */
let cache: UnidadeAberta | null = null
let voando: Promise<UnidadeAberta> | null = null
const ouvintes = new Set<(d: UnidadeAberta) => void>()

async function buscar(): Promise<UnidadeAberta> {
    try {
        const res = await fetch('/api/account/workspace')
        if (!res.ok) return VAZIO
        const data = await res.json()
        return {
            id: data.id ?? null,
            name: data.name ?? null,
            logo: data.logo ?? null,
            conta: data.conta ?? null,
            unidades: Array.isArray(data.unidades) ? data.unidades : [],
        }
    } catch {
        // Sem resposta, fica a marca do produto e nenhum seletor. É melhor que
        // um cabeçalho com um lugar vazio onde devia estar o nome da clínica.
        return VAZIO
    }
}

function carregar(forcar = false): Promise<UnidadeAberta> {
    if (forcar) {
        cache = null
        voando = null
    }
    if (cache) return Promise.resolve(cache)
    voando ??= buscar().then((d) => {
        cache = d
        voando = null
        ouvintes.forEach((avisar) => avisar(d))
        return d
    })
    return voando
}

export function useUnidades(): { dados: UnidadeAberta; carregando: boolean } {
    const [dados, setDados] = useState<UnidadeAberta>(() => cache ?? VAZIO)
    const [carregando, setCarregando] = useState(() => cache === null)

    useEffect(() => {
        let vivo = true

        const aplicar = (d: UnidadeAberta) => {
            if (!vivo) return
            setDados(d)
            setCarregando(false)
        }

        ouvintes.add(aplicar)
        void carregar().then(aplicar)

        const refazer = () => {
            void carregar(true).then(aplicar)
        }
        window.addEventListener(WORKSPACE_UPDATED, refazer)

        return () => {
            vivo = false
            ouvintes.delete(aplicar)
            window.removeEventListener(WORKSPACE_UPDATED, refazer)
        }
    }, [])

    return { dados, carregando }
}

/**
 * Põe a sessão em outra unidade e recarrega a página inteira.
 *
 * Recarga, e não `router.refresh()`: trocar de clínica troca **tudo** —
 * conversas, pacientes, agenda, agentes, limites do plano. Meia tela antiga ao
 * lado de meia tela nova é pior que a espera de um segundo, e é o tipo de estado
 * em que alguém responde o paciente errado.
 *
 * Devolve a mensagem de recusa quando há uma, para quem chama mostrar; em caso
 * de sucesso não devolve nada, porque a página já está indo embora.
 */
export async function trocarDeUnidade(workspaceId: string): Promise<string | null> {
    try {
        const res = await fetch('/api/workspace/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId }),
        })
        if (!res.ok) {
            const erro = await res.json().catch(() => ({}))
            return erro.error ?? 'Não foi possível trocar de unidade'
        }
        window.location.reload()
        return null
    } catch {
        return 'Não foi possível trocar de unidade'
    }
}
