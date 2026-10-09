/**
 * O termo de busca, do jeito que a coluna `searchText` guarda o conteúdo.
 *
 * O banco grava uma versão normalizada de cada registro — minúscula e sem
 * acento — numa coluna gerada. Para a comparação casar, o termo digitado passa
 * pela mesma normalização aqui. É só isto que faz "André", "Andre" e "andre"
 * localizarem a mesma pessoa; sem o par (coluna gerada + esta função), ILIKE
 * resolveria a caixa e ignoraria o acento.
 *
 * `NFD` separa a letra do diacrítico e `\p{Diacritic}` remove o diacrítico, o
 * que cobre todo o alfabeto latino em vez de uma tabela de pares escrita à mão.
 */
export function normalizeSearch(term: string): string {
    return term
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim()
}

/**
 * As formas pelas quais vale procurar o termo.
 *
 * Quase sempre uma só. A segunda aparece quando o termo tem pontuação e
 * dígitos — alguém colando "(31) 98850-1161" de outro sistema: a coluna guarda
 * telefone como dígitos, então a forma só-dígitos é a que casa. Sem ela, a
 * busca por telefone colado com máscara não acha nada, que é como ela se
 * comportava antes desta mudança.
 */
export function searchTerms(term: string): string[] {
    const base = normalizeSearch(term)
    const digits = base.replace(/\D/g, '')
    return digits && digits !== base && digits.length >= 4 ? [base, digits] : [base]
}
