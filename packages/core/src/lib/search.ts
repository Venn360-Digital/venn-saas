import { phoneVariants } from './whatsapp/types'

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
 *
 * E vêm as formas com e sem o nono dígito, quando o termo é um celular inteiro.
 * O motivo é que **as duas existem no banco**: conta registrada antes da
 * obrigatoriedade do 9 é endereçada pelo WhatsApp na forma antiga, e é essa
 * forma que chega no inbound e vira `Contact.phone` (ver `phoneVariants`).
 * Procurar só o que foi digitado obrigava a pessoa a tirar o 9 na mão para
 * achar a conversa — e ela não tem como saber de qual das duas formas aquele
 * paciente é. Quem já tinha isso certo eram os `findFirst` exatos do intake;
 * a busca de tela era o único lugar que ainda não.
 */
export function searchTerms(term: string): string[] {
    const base = normalizeSearch(term)
    const digits = base.replace(/\D/g, '')

    if (!digits || digits.length < 4) return [base]

    const formas = new Set<string>([base])
    if (digits !== base) formas.add(digits)
    for (const variante of phoneVariants(paraE164(digits))) formas.add(variante)

    return [...formas]
}

/**
 * Os dígitos digitados, na forma que a coluna guarda.
 *
 * `Contact.phone` é E.164 sem o `+` (`normalizePhone`), então é com o 55 na
 * frente que o celular inteiro casa — e é dele que `phoneVariants` sabe tirar
 * ou pôr o nono dígito. Comprimento de número nacional (10 ou 11) ganha o 55;
 * o resto passa intacto, porque adivinhar o país de um número estrangeiro é o
 * que criaria o falso positivo.
 */
function paraE164(digits: string): string {
    if (digits.startsWith('55')) return digits
    return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits
}
