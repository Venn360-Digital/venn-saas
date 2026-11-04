/**
 * Quem recebe a próxima conversa — a decisão, sem banco.
 *
 * Função pura sobre a lista de elegíveis, no padrão da casa: quem consulta é a
 * casca, quem decide é isto. O workerd não roda nesta máquina, então toda
 * escolha que precisa de prova vive aqui e é exercitada em Node por
 * `scripts/test-distribuicao.ts`.
 *
 * ## O que este módulo NÃO decide
 *
 * Não decide **quem está na lista**. Quem monta a lista é a consulta, que já
 * aplica o workspace, o departamento da linha, `isActive` e `recebeConversas`.
 * Misturar as duas coisas faria a parte testável depender do banco.
 *
 * Ver §11 de `docs/agente-ia/estudo-metodo-de-treinamento.md`.
 */

/** Os três estados. Só `disponivel` recebe — e só quando a política manda olhar. */
export type StatusDoMembro = 'disponivel' | 'ocupado' | 'ausente'

/** `nenhuma` desliga a distribuição: a conversa nasce sem dono, como antes. */
export type EstrategiaDeDistribuicao = 'nenhuma' | 'rodizio' | 'balanceado'

export interface MembroElegivel {
    userId: string
    status: StatusDoMembro
    /**
     * Quando esta pessoa recebeu a última conversa. **Nulo é "nunca recebeu"**,
     * e nunca recebeu vem primeiro — senão quem entra na equipe hoje só
     * receberia depois de todo mundo dar uma volta inteira.
     */
    ultimaAtribuicao: Date | null
    /** Conversas abertas em que é dona. Só o balanceado lê. */
    abertas: number
}

export interface PoliticaDeDistribuicao {
    estrategia: EstrategiaDeDistribuicao
    /**
     * O interruptor. **Desligado por padrão**, e a razão são dois formatos de
     * empresa que não cabem na mesma regra:
     *
     *   - empresa que atende 8h–18h: à noite estão todos ausentes. Com o filtro
     *     ligado, o lead da madrugada ficaria sem dono e ninguém teria carteira
     *     de manhã. Desligado, ele ganha dono e quem chega já tem o que fazer;
     *   - empresa com turnos: ligado, para o lead das 2h não cair em quem
     *     trabalha de manhã e nunca vai olhar.
     *
     * É o mesmo recorte do respond.io, onde "Rodada Robin" e "Robin redondo +
     * Apenas Online" são coisas separadas: online é **modificador** da
     * estratégia, não estratégia.
     */
    soDisponiveis: boolean
}

export const POLITICA_PADRAO: PoliticaDeDistribuicao = {
    estrategia: 'nenhuma',
    soDisponiveis: false,
}

/** `disponivel` recebe; `ocupado` e `ausente` não. Os dois últimos são iguais aqui. */
export function podeReceber(m: MembroElegivel, politica: PoliticaDeDistribuicao): boolean {
    return politica.soDisponiveis ? m.status === 'disponivel' : true
}

/**
 * Ordena pelo critério do rodízio: quem recebeu **há mais tempo** primeiro.
 *
 * Round robin **sem ponteiro**, de propósito. Um cursor guardado teria de ser
 * atualizado em transação, se corromperia na concorrência, e ficaria errado
 * toda vez que alguém entrasse ou saísse da equipe. Derivar a ordem de
 * `ultimaAtribuicao` não tem estado para corromper: a resposta é sempre
 * recalculada do fato.
 *
 * O desempate é o `userId`, e existe para a função ser **determinística** —
 * duas pessoas que nunca receberam têm de produzir sempre a mesma escolha, ou
 * o teste não prova nada.
 */
function porRodizio(a: MembroElegivel, b: MembroElegivel): number {
    const ta = a.ultimaAtribuicao?.getTime() ?? -Infinity
    const tb = b.ultimaAtribuicao?.getTime() ?? -Infinity
    if (ta !== tb) return ta - tb
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
}

/**
 * Quem fica com a próxima conversa. `null` quando não há ninguém.
 *
 * **`null` é resposta legítima, não erro.** Acontece com a estratégia
 * `nenhuma`, com a equipe toda ausente e o interruptor ligado, e na conta que
 * ainda não marcou ninguém como `recebeConversas`. Nos três casos a conversa
 * nasce sem dono e fica na fila geral — visível a todos —, e ganha dono quando
 * alguém ficar disponível ou no handoff.
 */
export function escolherDono(
    elegiveis: readonly MembroElegivel[],
    politica: PoliticaDeDistribuicao
): string | null {
    if (politica.estrategia === 'nenhuma') return null

    const candidatos = elegiveis.filter((m) => podeReceber(m, politica))
    if (candidatos.length === 0) return null

    if (politica.estrategia === 'balanceado') {
        /**
         * Menos conversas abertas, **com o rodízio como desempate**.
         *
         * Sem o desempate, uma equipe parada (todo mundo com zero aberta) daria
         * sempre a mesma pessoa — a primeira da lista —, e o "balanceado"
         * entregaria tudo a ela até ela passar à frente. O desempate por rodízio
         * é o que mantém a justiça quando a carga está igual.
         */
        return [...candidatos].sort((a, b) =>
            a.abertas !== b.abertas ? a.abertas - b.abertas : porRodizio(a, b)
        )[0].userId
    }

    return [...candidatos].sort(porRodizio)[0].userId
}

/**
 * Para onde vai a entrega quando o humano precisa entrar.
 *
 * **Esta é a parte que mais importa, e vale com o interruptor ligado ou
 * desligado.** O dono serve a duas coisas: a carteira ("minhas conversas") e
 * saber quem entra quando a IA não dá conta. A primeira tolera erro; a segunda
 * não.
 *
 * Se o dono não está disponível — foi embora, está em reunião, é de outro turno
 * —, a entrega **não fica parada com ele**: vai para a fila geral, que todo
 * mundo vê. O caso que isto evita é concreto: paciente com dor às 19h, dono
 * designado às 14h já em casa.
 *
 * Repare que aqui o status é lido **sempre**, e não só quando `soDisponiveis`
 * está ligado. O interruptor decide quem *recebe carteira*; isto decide quem
 * *atende agora*, e são perguntas diferentes.
 */
export function destinoDaEntrega(dono: MembroElegivel | null): string | null {
    if (!dono) return null
    return dono.status === 'disponivel' ? dono.userId : null
}
