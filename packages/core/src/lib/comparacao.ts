import crypto from 'node:crypto'

/**
 * Compara dois segredos em **tempo constante**.
 *
 * ## Por que existe, e por que é um lugar só
 *
 * Esta lógica estava escrita duas vezes — em `lib/meta/webhook.ts` e em
 * `lib/whatsapp/webhook-evolution-go.ts` — e **faltava numa terceira**: o
 * webhook do Asaas comparava o token com `===`. Três cópias do mesmo cuidado é
 * como a terceira acaba sem ele.
 *
 * ## O cuidado do comprimento
 *
 * `timingSafeEqual` **exige buffers do mesmo tamanho** e lança quando diferem.
 * Deixar lançar vazaria o comprimento do segredo pelo tempo de resposta — a
 * comparação que custou nada é justamente a que diz "o seu tem tamanho errado".
 * Então tamanho diferente é inválido, e pronto, sem chamar a função.
 *
 * Isso **não** torna o comprimento secreto: quem mede já sabe que errou o
 * tamanho. Torna o comprimento a única coisa que vaza, em vez de vazar também
 * o prefixo correto — que é o que permite adivinhar byte a byte.
 *
 * ## O que isto protege, honestamente
 *
 * Pouco, e vale dizer. Comparar string em tempo variável pela rede é um canal
 * ruidoso; atacar por ele exige milhares de requisições e condições de rede
 * boas. O motivo de usar assim mesmo é outro: o custo é uma linha, e a
 * alternativa é ter de julgar caso a caso qual segredo "merece" a comparação
 * constante. Nenhum merece o julgamento.
 */
export function igualEmTempoConstante(recebido: string, esperado: string | undefined | null): boolean {
    if (!esperado) return false
    if (!recebido) return false
    if (recebido.length !== esperado.length) return false
    return crypto.timingSafeEqual(Buffer.from(recebido, 'utf8'), Buffer.from(esperado, 'utf8'))
}
