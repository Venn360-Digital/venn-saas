import 'server-only'

import { getBillingState } from './billing'
import { getWorkspaceMember } from './auth/workspace'
import { TRIAL } from './plans'

/**
 * O que a faixa de avaliação precisa saber, resolvido no **servidor**.
 *
 * ## Por que no servidor
 *
 * A faixa é a proposta A, aprovada pelo Andre em 2026-11-04: presa abaixo da
 * barra superior, em toda tela, do primeiro ao último dia. Uma faixa que
 * **aparece depois** que a resposta de uma API chega empurraria o conteúdo da
 * página para baixo a cada navegação — e o olho lê isso como a tela pulando.
 * O layout do painel já é `force-dynamic` e já resolve a marca por requisição
 * pelo mesmo motivo (ver `session-brand.ts`); esta é a segunda consulta do
 * mesmo caminho, e ela devolve a faixa pronta no primeiro paint.
 *
 * ## Nunca lança
 *
 * Pelo mesmo motivo de `marcaDaSessao`: isto é lido no layout, no caminho de
 * TODA página do painel. Uma exceção aqui derrubaria a tela inteira para
 * mostrar uma faixa. Banco fora devolve `null`, a faixa não aparece, e o resto
 * do painel segue de pé.
 */
export interface Avaliacao {
    /** Dias cheios que faltam. Zero quer dizer "encerra hoje". */
    diasRestantes: number
    /** Quantos dias o período tem, para a trilha de segmentos. */
    diasTotais: number
    /**
     * O prazo acabou e a conta está em somente leitura — e por quê.
     *
     * `trial` é a avaliação que venceu, `corte` é a assinatura cancelada ou a
     * carência de atraso que terminou. As duas param a operação do mesmo jeito
     * e a faixa é a mesma; o que muda é a frase, porque dizer "avaliação
     * encerrada" a quem já pagou seria contar outra história.
     */
    encerrada: 'trial' | 'corte' | null
}

export async function avaliacaoDaSessao(): Promise<Avaliacao | null> {
    try {
        const auth = await getWorkspaceMember()
        if (!auth.ok) return null

        const estado = await getBillingState(auth.member.workspaceId)

        if (estado.phase === 'trial' && estado.remaining) {
            return {
                diasRestantes: estado.remaining.days,
                diasTotais: TRIAL.days,
                encerrada: null,
            }
        }

        if (estado.phase === 'readonly') {
            return {
                diasRestantes: 0,
                diasTotais: TRIAL.days,
                encerrada: estado.readOnlyMotivo ?? 'corte',
            }
        }

        // `active` e `none` não têm prazo correndo: sem faixa.
        return null
    } catch (erro) {
        console.error('[AVALIACAO]', erro)
        return null
    }
}
