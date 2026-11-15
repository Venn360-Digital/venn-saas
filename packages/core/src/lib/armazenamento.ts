/**
 * As chaves que o produto guarda no navegador, prefixadas pela marca.
 *
 * ## Por que não troca seca
 *
 * As chaves eram literais com o nome do primeiro produto
 * (`<produto>-sound-enabled`, `<produto>.inbox.emoji.recent`). Trocá-las por
 * um nome derivado da marca **apaga a preferência de quem já usa**: o som fica
 * ligado de novo, os emojis recentes voltam a zero, o contador de lembretes
 * reaparece. Nada quebra, nada lança — o usuário só percebe que o sistema
 * esqueceu dele.
 *
 * Então a leitura é DUPLA: busca a chave nova, e se não houver, busca a antiga,
 * **migra o valor** e apaga a velha. Uma vez por navegador, no primeiro acesso
 * depois do deploy. Depois disso só a nova existe.
 *
 * ## Por que o prefixo precisa ser da marca
 *
 * `localStorage` é por ORIGEM, não por aplicação. Dois produtos nossos abertos
 * no mesmo domínio (ou um deles num subdomínio que compartilhe origem) leriam
 * a mesma chave — e o som de um controlaria o do outro. O prefixo é o que os
 * separa, pela mesma razão do prefixo de cookie.
 *
 * ## Por que o prefixo é PARÂMETRO, e não lido da marca aqui
 *
 * Este módulo só roda no navegador — `localStorage` e `window` não existem no
 * servidor. E no navegador **ninguém registrou a marca**: o registro de
 * módulo (`../marca`) é avaliado pela raiz do App Router e pelo entrypoint do
 * Worker, os dois no servidor. Ler `BRAND()` daqui compila, builda, publica —
 * e lança na hidratação.
 *
 * Medido em 15/11/2026, com o módulo avaliado sem registro: `chave()` e
 * `evento()` lançam `MarcaNaoRegistradaError`, e `ler()` devolve `null`
 * silenciosamente (a exceção morre no `tentar`), o que **apaga a preferência
 * de todo mundo** — exatamente o acidente que a leitura dupla existe para
 * evitar, entregue por outro caminho.
 *
 * Com o prefixo obrigatório na assinatura, quem chama tem de ter de onde
 * tirá-lo, e no cliente o lugar é `useMarca().slug` (o provedor da raiz) —
 * `useArmazenamento()` faz essa ligação. A rede passa a ser o compilador, não
 * um linter: esquecer o argumento não compila.
 *
 * ## Nunca lança
 *
 * `localStorage` lança em modo privativo de alguns navegadores, com cookies de
 * terceiros bloqueados, e em iframe sem permissão. Isto é lido no caminho de
 * desenhar tela, então uma exceção aqui apagaria o componente inteiro. Falha
 * silenciosa devolve o padrão, que é o comportamento de quem nunca escolheu.
 */

/** `<slug>:som` — o nome de hoje. O prefixo é o `slug` da marca. */
export function chave(prefixo: string, nome: string): string {
    return `${prefixo}:${nome}`
}

function tentar<T>(f: () => T, padrao: T): T {
    try {
        return f()
    } catch {
        return padrao
    }
}

/**
 * Lê a chave nova; na ausência dela, migra a antiga.
 *
 * `antigas` é a lista de nomes que já foram usados, do mais recente ao mais
 * velho — um produto que renomeou duas vezes tem duas. A migração acontece uma
 * vez: o valor vai para a chave nova e a velha é removida.
 */
export function ler(prefixo: string, nome: string, antigas: string[] = []): string | null {
    return tentar(() => {
        const nova = chave(prefixo, nome)
        const atual = localStorage.getItem(nova)
        if (atual !== null) return atual
        for (const velha of antigas) {
            const valor = localStorage.getItem(velha)
            if (valor === null) continue
            localStorage.setItem(nova, valor)
            localStorage.removeItem(velha)
            return valor
        }
        return null
    }, null)
}

export function escrever(prefixo: string, nome: string, valor: string): void {
    tentar(() => localStorage.setItem(chave(prefixo, nome), valor), undefined)
}

export function remover(prefixo: string, nome: string, antigas: string[] = []): void {
    tentar(() => {
        localStorage.removeItem(chave(prefixo, nome))
        for (const velha of antigas) localStorage.removeItem(velha)
    }, undefined)
}

/**
 * O nome de um evento de janela, prefixado do mesmo jeito.
 *
 * Mesma razão das chaves: dois produtos na mesma origem despachariam o mesmo
 * evento. Aqui **não há migração** — evento não guarda estado, e um ouvinte
 * registrado com o nome antigo simplesmente deixa de ser chamado no recarregar
 * seguinte, sem perda de dado.
 */
export function evento(prefixo: string, nome: string): string {
    return `${prefixo}:${nome}`
}
