'use client'

import { useEffect, useRef } from 'react'

import { estadoVisivel, type StatusDoMembro } from '../lib/conversas/distribuicao'

/**
 * De quanto em quanto tempo o navegador conta ao servidor que a pessoa mexeu.
 *
 * Dois minutos, e só **quando houve gesto** desde o último batimento: uma
 * pessoa parada não gera escrita nenhuma, e é isso que deixa o Neon dormir à
 * noite — o problema que `useIntervaloVisivel` existe para resolver não volta
 * por aqui. Quem está trabalhando já faz outras requisições de qualquer jeito;
 * este batimento custa uma escrita a cada dois minutos por pessoa ativa.
 */
export const INTERVALO_DO_BATIMENTO_MS = 2 * 60_000

/** De quanto em quanto tempo a bolinha reavalia a escada, sem rede. */
const INTERVALO_DA_ESCADA_MS = 30_000

/**
 * Os gestos que contam como "mexeu no computador".
 *
 * Teclado, mouse, roda e toque. `pointermove` entra porque quem lê uma conversa
 * longa mexe o mouse sem clicar — e está presente. `scroll` não entra à parte:
 * a roda já é `wheel`, e o toque já é `touchstart`.
 */
const GESTOS: readonly (keyof WindowEventMap)[] = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']

interface Entrada {
    /**
     * Só com participação real numa unidade. Dentro da conta de um cliente a
     * participação é sintética e a rota recusaria; e sem `me` carregado não há
     * o que comparar.
     */
    ativo: boolean
    /** O que a pessoa **escolheu** — a coluna gravada, não a escada. */
    statusEscolhido: StatusDoMembro | null
    /** O primeiro degrau da escada para esta pessoa, em minutos. */
    minutosParaAusente: number
    /** Recebe o estado visível toda vez que ele muda — é o que pinta a bolinha. */
    aoMudar: (estado: StatusDoMembro) => void
}

/**
 * A presença de quem está na tela — medida pelo gesto, não pela requisição.
 *
 * ## O que isto conserta
 *
 * `ultimaAtividadeEm` era tocada em `getWorkspaceMember`, a cada requisição
 * autenticada. Parecia a medida certa e media outra coisa: a tela de conversas
 * relê a lista a cada minuto e o painel de equipe a cada trinta segundos, então
 * **uma aba aberta mantinha a pessoa verde para sempre** — a queda para ausente
 * medida ali era "fechou a aba", não "saiu da mesa". A recepcionista que foi
 * almoçar com o sistema aberto continuava recebendo conversa.
 *
 * Aqui a medida é o gesto: teclado, mouse, roda, toque. Sem gesto, nenhum
 * batimento sai, e a escada do servidor (`estadoVisivel`) faz o resto —
 * amarelo depois de `minutosParaAusente`, cinza depois de oito horas.
 *
 * ## Voltar é imediato
 *
 * Quando a escada já havia posto a pessoa em amarelo ou cinza e ela mexe de
 * novo, o batimento sai **na hora**, fora do intervalo: a bolinha volta ao
 * verde no primeiro gesto, e a equipe vê a volta no próximo polling do painel.
 * Esperar dois minutos aqui seria dizer "ausente" para alguém que está
 * digitando.
 *
 * ## A escolha manual continua pegajosa
 *
 * Quem se marcou `ocupado` ou `ausente` fica onde se pôs: a escada só mexe no
 * verde, e isto só manda o relógio. A pessoa que se marca ausente para o
 * almoço e volta não é devolvida ao verde por um gesto — é por um clique no
 * menu, ou pelo próximo login.
 *
 * ## A mesma conta do servidor
 *
 * `estadoVisivel` é a função pura que a distribuição usa. A bolinha é pintada
 * com ela, sobre o relógio local — então o que a pessoa vê e o que o sistema
 * faz saem do mesmo cálculo, sem esperar rede.
 */
export function usePresenca({ ativo, statusEscolhido, minutosParaAusente, aoMudar }: Entrada) {
    const ultimaInteracaoRef = useRef<number>(Date.now())
    const pendenteRef = useRef(false)
    const ultimoBatimentoRef = useRef(0)
    const estadoRef = useRef<StatusDoMembro | null>(null)
    const aoMudarRef = useRef(aoMudar)

    useEffect(() => {
        aoMudarRef.current = aoMudar
    }, [aoMudar])

    useEffect(() => {
        if (!ativo || !statusEscolhido) return

        let cancelado = false

        const emitir = (estado: StatusDoMembro) => {
            if (estadoRef.current === estado) return
            estadoRef.current = estado
            aoMudarRef.current(estado)
        }

        const derivado = () =>
            estadoVisivel(statusEscolhido, new Date(ultimaInteracaoRef.current), minutosParaAusente)

        const bater = async () => {
            ultimoBatimentoRef.current = Date.now()
            pendenteRef.current = false
            try {
                const res = await fetch('/api/me/atividade', { method: 'POST' })
                if (cancelado || !res.ok) return
                const dados = (await res.json()) as { disponibilidade?: StatusDoMembro }
                if (dados.disponibilidade) emitir(dados.disponibilidade)
            } catch {
                // Sem rede o relógio local continua valendo; o próximo gesto tenta de novo.
                pendenteRef.current = true
            }
        }

        const aoGesto = () => {
            const estavaFora = estadoRef.current === 'ausente' || estadoRef.current === 'desconectado'
            ultimaInteracaoRef.current = Date.now()
            pendenteRef.current = true
            // Voltou: pinta já e avisa já. A escada é aplicada ao status
            // escolhido, então quem se marcou ausente à mão fica ausente.
            emitir(derivado())
            if (estavaFora && statusEscolhido === 'disponivel') void bater()
        }

        const aoTrocarVisibilidade = () => {
            if (document.visibilityState === 'visible') aoGesto()
        }

        for (const g of GESTOS) window.addEventListener(g, aoGesto, { passive: true })
        document.addEventListener('visibilitychange', aoTrocarVisibilidade)

        // O primeiro estado sai do relógio local, sem rede: a montagem é um gesto.
        emitir(derivado())
        // E o primeiro batimento sai na montagem, para a volta de uma recarga
        // contar como presença — o login já gravou, mas a recarga de uma aba
        // esquecida é o caso em que a pessoa voltou e o servidor não sabe.
        void bater()

        const relogio = setInterval(() => {
            emitir(derivado())
            if (pendenteRef.current && Date.now() - ultimoBatimentoRef.current >= INTERVALO_DO_BATIMENTO_MS) {
                void bater()
            }
        }, INTERVALO_DA_ESCADA_MS)

        return () => {
            cancelado = true
            clearInterval(relogio)
            for (const g of GESTOS) window.removeEventListener(g, aoGesto)
            document.removeEventListener('visibilitychange', aoTrocarVisibilidade)
        }
    }, [ativo, statusEscolhido, minutosParaAusente])
}
