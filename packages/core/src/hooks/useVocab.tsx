'use client'

import { createContext, useContext, useEffect, useState } from 'react'

import { useMarca } from '../marca-contexto'
import type { Vocabulario } from '../lib/vocabulario'
import { WORKSPACE_UPDATED } from './useUnidades'

/**
 * As palavras do nicho, para quem desenha no cliente.
 *
 * CONTEXTO, NÃO `fetch` — e a razão é a mesma do `useMoeda`, que resolveu este
 * problema primeiro: o valor é lido por componentes que escrevem **o
 * substantivo de uma coluna à vista**. Um cabeçalho que nasce "Pacientes" e
 * vira "Clientes" um quadro depois não lê como carregamento; lê como o sistema
 * ter trocado de produto. Então o vocabulário desce do servidor pelo layout,
 * onde `marcaDaSessao()` já o resolveu junto da logomarca e da moeda, e o
 * primeiro paint sai certo.
 *
 * ## Duas camadas no servidor, uma resposta no cliente
 *
 * Quem resolve override-da-unidade sobre padrão-da-marca é `vocab()`, no
 * servidor, onde `Workspace.settings` existe. O cliente recebe o resultado.
 * Mandar as duas camadas para cá seria dar ao cliente a chance de resolvê-las
 * de forma diferente — duas fontes para a mesma palavra, que é como texto
 * divergente nasce.
 *
 * ## Fora do dashboard cai no padrão da marca, em vez de lançar
 *
 * Login, política de privacidade e a página de convite não têm unidade: não há
 * `Workspace.settings` para ler, e exigir o provedor ali obrigaria cada uma a
 * montar um só para dizer "não sei de nada". O padrão da marca é a resposta
 * certa nesses lugares — e vem de `useMarca()`, que o provedor da raiz garante
 * em toda tela.
 */
const VocabContext = createContext<Vocabulario | null>(null)

export function VocabularioProvider({
    vocabulario,
    children,
}: {
    vocabulario: Vocabulario | null | undefined
    children: React.ReactNode
}) {
    const padrao = useMarca().vocabulario
    const [atual, setAtual] = useState<Vocabulario>(vocabulario ?? padrao)

    /**
     * O servidor manda um valor novo a cada navegação, e ele vence o estado.
     *
     * Ajustado DURANTE o render, não num `useEffect` — é o padrão que o React
     * documenta para "estado que acompanha uma prop". Num efeito, o quadro já
     * estaria pintado com a palavra antiga, que é o pisca que este provedor
     * existe para não ter.
     */
    const [vistoDoServidor, setVistoDoServidor] = useState(vocabulario)
    if (vocabulario !== vistoDoServidor) {
        setVistoDoServidor(vocabulario)
        setAtual(vocabulario ?? padrao)
    }

    useEffect(() => {
        async function reler() {
            try {
                const res = await fetch('/api/account/workspace')
                if (!res.ok) return
                const data = await res.json()
                if (data.vocabulario) setAtual(data.vocabulario)
            } catch {
                // Sem resposta, ficam as palavras que o servidor já entregou:
                // são as certas até alguém trocá-las, e quem trocou está
                // olhando para um erro de qualquer forma.
            }
        }
        window.addEventListener(WORKSPACE_UPDATED, reler)
        return () => window.removeEventListener(WORKSPACE_UPDATED, reler)
    }, [])

    return <VocabContext.Provider value={atual}>{children}</VocabContext.Provider>
}

/**
 * As palavras do nicho desta unidade.
 *
 * Fora de um `VocabularioProvider` devolve o padrão da marca — ver o cabeçalho.
 */
export function useVocab(): Vocabulario {
    const doContexto = useContext(VocabContext)
    const padrao = useMarca().vocabulario
    return doContexto ?? padrao
}
