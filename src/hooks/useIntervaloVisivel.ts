'use client'

import { useEffect, useRef } from 'react'

/**
 * Repete algo em intervalo, **mas só enquanto alguém está olhando**.
 *
 * ## O que isto conserta, medido
 *
 * A tela de conversas chamava `setInterval(fetchConversações, 15000)` sem
 * condição nenhuma. Três consequências, e a terceira é a caríssima:
 *
 * 1. a aba em segundo plano continuava perguntando;
 * 2. a aba esquecida aberta de noite também;
 * 3. e cada pergunta vai ao banco — o que impede o Neon de suspender, porque a
 *    ociosidade dele é de **5 minutos** e a pergunta chegava a cada 15 s.
 *
 * Em 2026-11-07 isso estourou a franquia e a produção saiu do ar: 142,8 h de
 * compute acordado em 7 dias (20,4 h/dia) num sistema com um cliente. O cron já
 * havia sido ajustado em 23/10 justamente para o banco poder dormir, e o ajuste
 * foi anulado pelo navegador, que ninguém contou.
 *
 * ## Por que `visibilitychange` e não "pausar depois de X minutos sem clique"
 *
 * Inatividade é palpite; visibilidade é fato. A recepcionista que lê uma
 * conversa sem tocar no teclado por dez minutos **está** olhando, e pausar por
 * inatividade a deixaria com a lista velha. A aba atrás do navegador não está
 * sendo lida por ninguém — isso o navegador sabe e conta.
 *
 * ## Dispara ao voltar, e é o que torna a pausa segura
 *
 * Voltar para a aba executa imediatamente, antes de recomeçar o intervalo. Sem
 * isso, quem voltasse veria dados de minutos atrás por até um ciclo inteiro — e
 * a pausa teria trocado custo por tela errada, o que não é troca.
 *
 * O tempo real (SSE) continua sendo o caminho principal e **não** é pausado por
 * aqui: ele é empurrado pelo servidor e não custa consulta. Isto é a rede.
 */
export function useIntervaloVisivel(acao: () => void, intervaloMs: number) {
    /**
     * A ação vive numa `ref`, e não nas dependências do efeito.
     *
     * Quem chama costuma passar função recriada a cada render (`fetchX` com
     * `useCallback` que depende de filtros). Nas dependências, cada mudança de
     * filtro destruiria e recriaria o temporizador — e o relógio reiniciaria do
     * zero, às vezes nunca chegando ao fim. Na `ref`, o temporizador é um só e
     * sempre chama a versão mais nova.
     */
    const acaoRef = useRef(acao)
    /**
     * A atualização vai num efeito, e **não** no corpo do render.
     *
     * `acaoRef.current = acao` solto no render é o padrão que o React avisa
     * contra, e com razão: render pode ser descartado (Strict Mode renderiza
     * duas vezes, Suspense desiste e refaz), e a escrita feita num render
     * descartado fica — deixando a `ref` apontando para uma versão da função
     * que nunca chegou à tela.
     */
    useEffect(() => {
        acaoRef.current = acao
    }, [acao])

    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | null = null

        const visivel = () =>
            typeof document === 'undefined' || document.visibilityState === 'visible'

        const parar = () => {
            if (timer) clearInterval(timer)
            timer = null
        }

        const comecar = () => {
            parar()
            timer = setInterval(() => acaoRef.current(), intervaloMs)
        }

        const aoTrocar = () => {
            if (visivel()) {
                // Primeiro busca, depois reagenda: ver a nota sobre voltar.
                acaoRef.current()
                comecar()
            } else {
                parar()
            }
        }

        if (visivel()) comecar()
        document.addEventListener('visibilitychange', aoTrocar)

        return () => {
            parar()
            document.removeEventListener('visibilitychange', aoTrocar)
        }
    }, [intervaloMs])
}
