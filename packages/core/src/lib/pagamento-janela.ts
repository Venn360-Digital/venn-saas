import { BRAND } from '../marca'

/**
 * Os dois nomes que ligam a janela de pagamento à tela que a abriu.
 *
 * ## Por que vêm da marca
 *
 * `window.open(url, nome)` reusa a janela de mesmo nome, e `postMessage` só é
 * aceito se o `tipo` casar. Com dois produtos nossos abertos no mesmo
 * navegador e nomes iguais, o pagamento de um reusaria a janela do outro e a
 * confirmação chegaria à tela errada. O prefixo da marca é o que os separa.
 *
 * ## Não há migração aqui, e isso é deliberado
 *
 * Diferente das chaves de `localStorage`, estes nomes não guardam estado: eles
 * valem durante **um** fluxo de pagamento, que dura segundos. Uma janela aberta
 * antes do deploy e confirmada depois cairia no aviso de "feche à mão" que o
 * código já tem para origem inacessível — nada de dado se perde, e o pior caso
 * é um clique a mais.
 *
 * Um módulo à parte porque os dois lados precisam dos MESMOS valores: a tela do
 * plano, que abre e escuta, e a rota de retorno, que responde. Divergir aqui
 * faria a confirmação nunca chegar, e a tela ficaria girando sem erro nenhum.
 */

let prefixoCache: string | null = null
function prefixo(): string {
    if (prefixoCache === null) prefixoCache = BRAND().slug
    return prefixoCache
}

/** O nome da janela: `window.open` reusa a de mesmo nome. */
export function nomeDaJanelaDePagamento(): string {
    return `${prefixo()}-pagamento`
}

/** O `tipo` do `postMessage` — a tela só aceita este. */
export function tipoDaMensagemDePagamento(): string {
    return `${prefixo()}:pagamento`
}
