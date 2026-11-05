'use client'

import {
    conectarTempoReal,
    type Conexao,
    type EstadoDaConexao,
    type Ouvintes,
} from './cliente'

/**
 * Uma conexão por aba, assinada por quantas telas quiserem.
 *
 * ## Por que existe
 *
 * `conectarTempoReal` abre um WebSocket por chamada, e eram duas as chamadas:
 * a tela de Conversas e o `GatilhoDaEquipe`, que vive no cabeçalho de **todas**
 * as telas. Numa aba aberta em Conversas eram duas conexões para a mesma sala —
 * dois bilhetes, dois `ola`, dois pings de 25 s, e o mesmo evento entregue duas
 * vezes pela borda. Com três pessoas por conta isso não aparecia em nada; com
 * vinte atendentes de Conversas aberta o dia inteiro, dobra a conta de conexão
 * aberta no Durable Object sem dobrar nada de útil.
 *
 * Este módulo é o multiplexador: mantém **uma** conexão enquanto houver ao
 * menos um assinante, e distribui o que chega. O `cliente.ts` continua sendo
 * quem sabe reconectar, deduplicar e pedir bilhete — nada disso desceu para cá,
 * porque ali é testável e aqui é contagem de referência.
 *
 * ## O atraso para fechar não é folga, é o React
 *
 * Desassinar não fecha na hora: espera {@link ESPERA_PARA_FECHAR_MS}. Sem isso,
 * três situações normais derrubariam e reabririam o socket — cada vez um POST de
 * bilhete e um novo `ola`:
 *
 *   1. o StrictMode do desenvolvimento, que monta, desmonta e monta de novo;
 *   2. o efeito de Conversas, cujas dependências mudam de identidade;
 *   3. navegar de Conversas para outra tela e voltar.
 *
 * Com a espera, o assinante novo encontra a conexão ainda de pé e o cancelamento
 * é descartado.
 *
 * ## O que o assinante tem de fazer sozinho
 *
 * **Carregar o seu estado inicial por HTTP.** O `sincronizar` é repassado como
 * vem do servidor — primeira conexão ou lacuna maior que o histórico da sala —,
 * e quem assina depois da conexão já estabelecida **não** recebe um sintético no
 * lugar. Não é esquecimento: assinante novo não tem estado nenhum para
 * reconciliar, então ele carrega do servidor de qualquer forma, e um
 * `sincronizar` fabricado só duplicaria a busca que ele acabou de fazer. Ambos
 * os assinantes de hoje já fazem a carga inicial num efeito próprio.
 */

/** Ver o bloco acima: o suficiente para cobrir remonte, não para segurar socket ocioso. */
const ESPERA_PARA_FECHAR_MS = 2_000

const assinantes = new Set<Ouvintes>()

let conexao: Conexao | null = null
let fechamento: ReturnType<typeof setTimeout> | null = null

/**
 * Entrega para todos, e **um assinante que explode não cala os outros**.
 *
 * Sem o try, uma exceção dentro do ouvinte de uma tela abortaria o laço e as
 * telas seguintes nunca receberiam o evento — com a conexão viva e tudo
 * aparentemente bem, que é o defeito mais difícil de achar que este módulo
 * poderia introduzir.
 */
function distribuir(entrega: (ouvintes: Ouvintes) => void): void {
    for (const assinante of assinantes) {
        try {
            entrega(assinante)
        } catch (erro) {
            console.error('[TEMPO-REAL] assinante falhou ao tratar o evento:', erro)
        }
    }
}

function abrirSePreciso(): void {
    if (fechamento) {
        clearTimeout(fechamento)
        fechamento = null
    }
    if (conexao) return

    conexao = conectarTempoReal({
        evento(tipo, payload) {
            distribuir((a) => a.evento(tipo, payload))
        },
        sincronizar(motivo) {
            distribuir((a) => a.sincronizar(motivo))
        },
        estado(novo) {
            distribuir((a) => a.estado?.(novo))
        },
    })
}

/**
 * Assina o tempo real da aba. Devolve o que cancela a assinatura.
 *
 * Feito para `useEffect`: chame no efeito e devolva o cancelador. A conexão
 * abre na primeira assinatura e fecha quando a última sai — depois da espera.
 */
export function assinarTempoReal(ouvintes: Ouvintes): () => void {
    assinantes.add(ouvintes)
    abrirSePreciso()

    return () => {
        assinantes.delete(ouvintes)
        if (assinantes.size > 0 || !conexao || fechamento) return

        fechamento = setTimeout(() => {
            fechamento = null
            // Alguém pode ter assinado dentro da espera; nesse caso
            // `abrirSePreciso` já limpou este timer e não chegamos aqui.
            if (assinantes.size > 0) return
            conexao?.fechar()
            conexao = null
        }, ESPERA_PARA_FECHAR_MS)
    }
}

/** O estado da conexão compartilhada. `caido` quando não há nenhuma de pé. */
export function estadoDoTempoReal(): EstadoDaConexao {
    return conexao?.estado() ?? 'caido'
}
