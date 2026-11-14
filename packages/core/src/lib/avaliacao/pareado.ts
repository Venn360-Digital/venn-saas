import type { VereditoCego } from './juiz'

/**
 * A comparação pareada: o embaralho, a agregação, o canário e o holdout.
 *
 * Parte pura. É aqui que moram as defesas contra o juiz errar de forma
 * sistemática — ver o cabeçalho de `juiz.ts` para o mapa das quatro.
 *
 * ## Por que pareado, e não nota
 *
 * Dar nota de 1 a 5 a uma resposta isolada concorda pouco com humano. Pôr duas
 * lado a lado e perguntar "qual é melhor" concorda muito mais (até +12 pontos de
 * Macro-F1 na literatura de 2026). E é a pergunta que o produto de fato tem:
 * ninguém quer saber se o agente é "4 de 5", quer saber se **esta** mudança de
 * treinamento melhorou ou piorou.
 */

/** Qual dos dois candidatos é qual, depois de o rótulo cego ser desfeito. */
export type Lado = 'rascunho' | 'publicado'

/**
 * A ordem em que os dois foram mostrados ao juiz.
 *
 * `'rascunho-primeiro'` quer dizer que o rascunho apareceu como A.
 */
export type Ordem = 'rascunho-primeiro' | 'publicado-primeiro'

/**
 * Em que ordem mostrar este caso — **determinístico pelo id**.
 *
 * Duas exigências que parecem opostas e não são:
 *
 *   - a ordem tem de **variar** entre casos, senão o viés de posição do juiz
 *     (preferir o primeiro, ou o segundo) vira um viés a favor de um dos lados
 *     em toda a bateria;
 *   - a ordem tem de ser **reprodutível**, senão rodar a mesma avaliação duas
 *     vezes dá números diferentes e ninguém sabe se a mudança foi do treinamento
 *     ou do sorteio.
 *
 * `Math.random()` atende a primeira e falha a segunda. O hash do id atende as
 * duas: varia entre casos e não varia entre execuções.
 */
export function ordemDoCaso(id: string): Ordem {
    let h = 0
    for (let i = 0; i < id.length; i++) {
        h = (h * 31 + id.charCodeAt(i)) | 0
    }
    return (h & 1) === 0 ? 'rascunho-primeiro' : 'publicado-primeiro'
}

/** Quem é A e quem é B, dada a ordem. */
export function embaralhar(
    ordem: Ordem,
    rascunho: string,
    publicado: string
): { a: string; b: string } {
    return ordem === 'rascunho-primeiro' ? { a: rascunho, b: publicado } : { a: publicado, b: rascunho }
}

/**
 * Desfaz o rótulo cego: de "preferiu A" para "preferiu o rascunho".
 *
 * `null` atravessa como `null`. Veredito ilegível não vira empate — ver
 * `interpretarVeredito`.
 */
export function quemGanhou(ordem: Ordem, veredito: VereditoCego | null): Lado | 'empate' | null {
    if (veredito === null) return null
    if (veredito === 'EMPATE') return 'empate'

    const primeiro: Lado = ordem === 'rascunho-primeiro' ? 'rascunho' : 'publicado'
    const segundo: Lado = primeiro === 'rascunho' ? 'publicado' : 'rascunho'
    return veredito === 'A' ? primeiro : segundo
}

export interface Agregado {
    /** Casos em que o juiz preferiu o rascunho. */
    rascunho: number
    publicado: number
    empates: number
    /** Vereditos que o parser não entendeu. Contados à parte, nunca somados. */
    ilegiveis: number
    /** Casos com veredito legível. É o denominador honesto. */
    validos: number
    /**
     * Preferência pelo rascunho entre os válidos, de 0 a 1, com empate valendo
     * meio para cada lado — é como se mede preferência pareada.
     *
     * Nulo quando não houve caso válido: dividir por zero e devolver 0 diria
     * "o rascunho perdeu", que é diferente de "não se mediu".
     */
    preferencia: number | null
}

export function agregar(resultados: (Lado | 'empate' | null)[]): Agregado {
    const rascunho = resultados.filter((r) => r === 'rascunho').length
    const publicado = resultados.filter((r) => r === 'publicado').length
    const empates = resultados.filter((r) => r === 'empate').length
    const ilegiveis = resultados.filter((r) => r === null).length
    const validos = rascunho + publicado + empates

    return {
        rascunho,
        publicado,
        empates,
        ilegiveis,
        validos,
        preferencia: validos === 0 ? null : (rascunho + empates / 2) / validos,
    }
}

/**
 * Quantos casos, no mínimo, para o número querer dizer algo.
 *
 * Com 5 casos, 3 a 2 é 60% de preferência e é ruído puro. Trinta é o ponto em
 * que uma diferença de 15 pontos começa a se separar do acaso num teste de
 * sinal — e é um número que um instrutor consegue juntar guardando casos no
 * ensaio ao longo de uma semana.
 */
export const CASOS_MINIMOS = 30

/**
 * O canário: a nota perfeita é suspeita, não vitória.
 *
 * Duas formas de desconfiar, e as duas aconteceram na literatura:
 *
 *   - **preferência total.** O rascunho ganhando 100% de 40 casos quase nunca é
 *     um treinamento melhor; é o juiz lendo alguma pista do formato (um dos
 *     lados mais longo, ou com emoji, ou citando o número do trecho);
 *   - **empate total.** O juiz devolvendo empate em tudo quer dizer que ele não
 *     está olhando — e isso passa despercebido porque "empate" parece um
 *     resultado.
 *
 * Também desconfia de amostra pequena e de muitos ilegíveis: um juiz cujo
 * formato o parser não entende em 1 de 5 casos não está sendo lido.
 */
export function suspeitas(agregado: Agregado): string[] {
    const motivos: string[] = []

    if (agregado.validos < CASOS_MINIMOS) {
        motivos.push(
            `poucos casos (${agregado.validos} de ${CASOS_MINIMOS}): a preferência ainda é ruído`
        )
    }

    if (agregado.validos > 0 && agregado.ilegiveis / (agregado.validos + agregado.ilegiveis) > 0.1) {
        motivos.push(
            `${agregado.ilegiveis} veredito(s) ilegível(is): o juiz não está sendo lido`
        )
    }

    if (agregado.validos >= 10) {
        if (agregado.rascunho === agregado.validos) {
            motivos.push('preferência de 100% pelo rascunho: suspeite de pista no formato')
        }
        if (agregado.publicado === agregado.validos) {
            motivos.push('preferência de 100% pelo publicado: suspeite de pista no formato')
        }
        if (agregado.empates === agregado.validos) {
            motivos.push('empate em todos os casos: o juiz não está discriminando')
        }
    }

    return motivos
}

/**
 * Fração do conjunto que fica **congelada**, fora de toda afinação.
 *
 * O holdout existe porque otimizar contra o conjunto que mede é o caminho mais
 * curto para um número bonito e um agente pior: a cada rodada o treinamento
 * aprende as idiossincrasias daqueles casos, e a medição deixa de falar sobre
 * atendimento e passa a falar sobre si mesma.
 */
export const FRACAO_DE_HOLDOUT = 0.2

/**
 * Este caso é de holdout? **Determinístico pelo id, e para sempre.**
 *
 * Sortear no momento da avaliação faria um caso migrar entre os dois conjuntos
 * entre execuções, o que destrói justamente a propriedade que o holdout
 * compra. Pelo id, a resposta de hoje é a de sempre — inclusive depois de um
 * deploy, e sem coluna nenhuma no banco.
 */
export function ehHoldout(id: string): boolean {
    let h = 0
    for (let i = 0; i < id.length; i++) {
        h = (h * 131 + id.charCodeAt(i)) >>> 0
    }
    return (h % 1000) / 1000 < FRACAO_DE_HOLDOUT
}

/**
 * Kappa de Cohen entre dois anotadores, sobre as mesmas escolhas.
 *
 * Serve à calibração do juiz: antes de confiar nele, duas pessoas rotulam de 100
 * a 300 casos e se mede a concordância entre elas; depois se mede o juiz contra
 * elas na mesma escala. Acima de 0,6 é aceitável, acima de 0,8 é forte.
 *
 * Kappa e não "porcentagem de acerto" porque, com três rótulos e um deles
 * dominante, concordar 70% pode ser pior do que o acaso. Kappa desconta o
 * acaso.
 *
 * Devolve `null` quando as listas têm tamanhos diferentes ou estão vazias — não
 * há concordância a medir, e um zero ali mentiria dizendo "discordam".
 */
export function kappa(a: string[], b: string[]): number | null {
    if (a.length === 0 || a.length !== b.length) return null

    const n = a.length
    const observada = a.filter((x, i) => x === b[i]).length / n

    const rotulos = [...new Set([...a, ...b])]
    const esperada = rotulos.reduce((soma, r) => {
        const pa = a.filter((x) => x === r).length / n
        const pb = b.filter((x) => x === r).length / n
        return soma + pa * pb
    }, 0)

    // Concordância esperada de 1 quer dizer que todos escolheram o mesmo rótulo
    // sempre: kappa é indefinido ali, e 1 é a leitura honesta (concordaram).
    if (esperada === 1) return observada === 1 ? 1 : 0

    return (observada - esperada) / (1 - esperada)
}
