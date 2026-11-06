import 'server-only'

/**
 * O token do convite: sorteado, entregue uma vez, guardado em resumo.
 *
 * ## O banco NÃO guarda o token
 *
 * Guarda o SHA-256 dele. A diferença importa porque o token **é** a
 * credencial: quem o tem define a senha de um usuário novo dentro da clínica.
 * Com o valor em claro na coluna, qualquer leitura do banco — um dump de
 * backup, um `SELECT` de suporte, a tela de um console — entrega acesso. Com o
 * resumo, uma leitura entrega nada: não há como voltar do hash para o link.
 *
 * É a mesma lógica da senha, e a mesma razão. O que muda é o custo: senha é
 * curta e escolhida por gente, então precisa de hash lento (bcrypt/argon). O
 * token tem 256 bits sorteados por `crypto.getRandomValues`, então não há o que
 * adivinhar e um SHA-256 basta — não existe dicionário de tokens aleatórios.
 *
 * ## O link aparece uma vez
 *
 * Quem convida não pode reler o link depois: ele vai no e-mail e o servidor
 * esquece o valor. Se a pessoa não recebeu, o caminho é **reenviar** — que
 * sorteia outro token e invalida o anterior pela troca do resumo.
 */

const BYTES = 32

/** O token em claro + o resumo que vai para o banco. O claro nunca é gravado. */
export interface TokenNovo {
    token: string
    tokenHash: string
}

/**
 * Sorteia um token novo.
 *
 * `base64url` e não hex: o mesmo número de bits em 43 caracteres em vez de 64,
 * e sem caractere que precise de escape na URL. O token vai num
 * `/convite/<token>`, e `+`, `/` e `=` do base64 comum quebrariam isso.
 */
export async function sortearToken(): Promise<TokenNovo> {
    const bytes = new Uint8Array(BYTES)
    crypto.getRandomValues(bytes)

    let bruto = ''
    for (const b of bytes) bruto += String.fromCharCode(b)
    const token = btoa(bruto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    return { token, tokenHash: await resumoDoToken(token) }
}

/**
 * O resumo de um token, para procurar a linha.
 *
 * `crypto.subtle` e não `node:crypto`: é o que existe no Worker, e é o mesmo
 * caminho no `next dev`. Um `require('crypto')` aqui compilaria e falharia em
 * produção.
 */
export async function resumoDoToken(token: string): Promise<string> {
    const dados = new TextEncoder().encode(token)
    const digest = await crypto.subtle.digest('SHA-256', dados)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * O token veio de um link plausível?
 *
 * Checagem de **forma**, antes de ir ao banco. Serve a duas coisas: não gastar
 * uma consulta com `/convite/undefined`, que é o que um link truncado produz,
 * e não deixar entrar caractere que não pertence ao alfabeto do nosso sorteio.
 *
 * Não é segurança — a segurança é o resumo não existir na tabela. É higiene.
 */
export function pareceToken(valor: string | undefined | null): boolean {
    return typeof valor === 'string' && /^[A-Za-z0-9_-]{40,50}$/.test(valor)
}
