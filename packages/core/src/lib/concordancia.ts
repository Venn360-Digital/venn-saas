import type { Vocabulario } from './vocabulario'

/**
 * A palavra do nicho com o determinante que concorda com ela.
 *
 * ## Por que existe
 *
 * Trocar só o substantivo quebra a frase. Medido em 14/11/2026, antes de
 * escrever isto: **228 das 548 ocorrências** de palavra do nicho em
 * `packages/` vêm precedidas de determinante — 103 de artigo definido, 74 de
 * `de`+artigo, 27 de demonstrativo, 12 de `a`+artigo, 11 de indefinido. 42% dos
 * casos, não uma borda.
 *
 * Sem concordância, "abrir **o** paciente" vira "**o** clínica" num nicho
 * feminino, e "**a** clínica" vira "**a** estúdio". Texto quebrado assim não
 * falha em teste nenhum: ele aparece na tela do cliente.
 *
 * ## O gênero é declarado, não deduzido
 *
 * Vem de `BRAND().vocabulario.genero`. "Paciente" e "cliente" são comuns de
 * dois gêneros — qual se usa é escolha de quem escreve o produto, não do
 * dicionário. E deduzir por terminação erraria em "a agente", "o profissional",
 * "a equipe".
 *
 * ## Uso
 *
 *     const v = useVocab()
 *     `Não foi possível abrir ${comArtigo(v, 'pessoa')}`      → o paciente
 *     `A agenda ${comArtigo(v, 'profissional', 'de')}`        → do especialista
 *     `Enviado ${comArtigo(v, 'pessoas', 'a')}`               → aos pacientes
 *     `${comArtigo(v, 'organizacao', 'este')}`                → esta clínica
 *
 * Onde não há determinante, use a palavra direto: `v.Pessoas` num cabeçalho de
 * coluna, `v.servico` no meio de uma frase sem artigo.
 */

/** Os eixos, nas quatro formas que o contrato declara. */
export type Eixo =
    | 'organizacao' | 'Organizacao' | 'organizacoes' | 'Organizacoes'
    | 'pessoa' | 'Pessoa' | 'pessoas' | 'Pessoas'
    | 'profissional' | 'Profissional' | 'profissionais' | 'Profissionais'
    | 'servico' | 'Servico' | 'servicos' | 'Servicos'

/**
 * As contrações que o produto usa, medidas no código em vez de supostas.
 *
 * `de`, `a`, `em`, `por` e os demonstrativos cobrem os 228 casos encontrados.
 * `com`, `sem` e `para` não contraem com artigo em português e por isso não
 * entram: escreve-se "com o paciente", e aí basta `com ${comArtigo(v, 'pessoa')}`.
 */
export type Contracao = 'de' | 'a' | 'em' | 'por' | 'este' | 'esse' | 'um'

/** Singular ou plural, pela forma do eixo — não por um argumento a mais. */
function ehPlural(eixo: Eixo): boolean {
    return eixo.endsWith('s') && !eixo.endsWith('ês')
}

/** Maiúscula na inicial, pela forma do eixo. */
function ehMaiuscula(eixo: Eixo): boolean {
    return eixo[0] === eixo[0].toUpperCase()
}

/** De qual dos quatro eixos a forma é. */
function raiz(eixo: Eixo): keyof Vocabulario['genero'] {
    const base = eixo.toLowerCase()
    if (base.startsWith('organizac')) return 'organizacao'
    if (base.startsWith('pessoa')) return 'pessoa'
    if (base.startsWith('profissiona')) return 'profissional'
    return 'servico'
}

/**
 * A tabela de determinantes.
 *
 * Escrita por extenso, e não montada por concatenação: as contrações do
 * português não seguem regra única ("de"+"a" = "da", mas "a"+"a" = "à" com
 * crase, e "por"+"o" = "pelo", que não se parece com nenhum dos dois).
 */
const DETERMINANTE: Record<
    Contracao | 'artigo',
    { m: string; f: string; mp: string; fp: string }
> = {
    artigo: { m: 'o', f: 'a', mp: 'os', fp: 'as' },
    de: { m: 'do', f: 'da', mp: 'dos', fp: 'das' },
    a: { m: 'ao', f: 'à', mp: 'aos', fp: 'às' },
    em: { m: 'no', f: 'na', mp: 'nos', fp: 'nas' },
    por: { m: 'pelo', f: 'pela', mp: 'pelos', fp: 'pelas' },
    este: { m: 'este', f: 'esta', mp: 'estes', fp: 'estas' },
    esse: { m: 'esse', f: 'essa', mp: 'esses', fp: 'essas' },
    um: { m: 'um', f: 'uma', mp: 'uns', fp: 'umas' },
}

/**
 * `comArtigo(v, 'pessoa')` → "o paciente". Com contração: `'de'` → "do paciente".
 *
 * A forma do eixo decide o número e a capitalização: `'pessoas'` dá plural,
 * `'Pessoa'` dá inicial maiúscula no DETERMINANTE (que é o que começa a frase).
 */
export function comArtigo(v: Vocabulario, eixo: Eixo, contracao?: Contracao): string {
    const genero = v.genero[raiz(eixo)]
    const chave = ehPlural(eixo) ? (genero === 'm' ? 'mp' : 'fp') : genero
    const det = DETERMINANTE[contracao ?? 'artigo'][chave]
    const palavra = v[eixo]
    /*
     * A maiúscula vai para o DETERMINANTE, não para a palavra: "O paciente
     * não tem compromissos" — quem começa a frase é o artigo. Então a forma
     * capitalizada do eixo serve para quando a palavra aparece sozinha, e aqui
     * ela volta para minúscula.
     */
    if (ehMaiuscula(eixo)) {
        const minuscula = palavra.charAt(0).toLowerCase() + palavra.slice(1)
        return `${det.charAt(0).toUpperCase() + det.slice(1)} ${minuscula}`
    }
    return `${det} ${palavra}`
}
