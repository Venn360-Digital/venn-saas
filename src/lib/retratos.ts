/**
 * O retrato de quem aparece no cartão da conversa: a foto, servida por URL.
 *
 * ## O problema que este módulo existe para não repetir
 *
 * O Andre pediu que o cartão mostrasse a **foto** do agente e do responsável, e
 * o nome só quando não há foto. Parece uma troca de JSX, e não é: do jeito que
 * os retratos são guardados hoje, pôr foto no cartão piora a tela em vez de
 * melhorá-la. Dois defeitos, medidos:
 *
 * 1. **O retrato de usuário é um data URI na coluna.** Em produção, o do Andre
 *    tem **277 026 bytes** de base64 em `users.avatar`. A rota da lista já
 *    devolve `assignedToAvatar` por conversa — então uma página de conversas
 *    dele repete os 277 KB por cartão. Duas pessoas, 45 conversas abertas, e a
 *    resposta carrega centenas de KB de imagem repetida.
 * 2. **O retrato de agente é uma URL assinada de 600 s.** `enderecoDoAvatar`
 *    resolve a referência de acervo em `urlAssinada`, e `VALIDADE_MAXIMA_SEGUNDOS`
 *    é 600. Como `PUBLIC_STORAGE_BASE_URL` **não é declarada** em
 *    `cloudflare.config.ts`, nem a classe pública escapa da assinatura. Numa
 *    coluna que fica aberta a manhã inteira, as fotos sumiriam em dez minutos.
 *
 * ## A solução: identidade na URL, bytes atrás dela
 *
 * A lista passa a devolver **um endereço**, nunca os bytes. O endereço carrega
 * `v`, que é o `updatedAt` da linha: enquanto a foto não muda, a URL não muda e
 * o navegador serve do cache; quando muda, a URL muda e o cache é furado sem
 * precisar invalidar nada. A resposta pode então ser `immutable` por um ano.
 *
 * O ganho é de ordem de grandeza e não de ajuste: o mesmo retrato é baixado
 * **uma vez por pessoa**, não uma vez por cartão, e deixa de existir na resposta
 * JSON da lista.
 *
 * Os dois defeitos de guarda continuam lá — data URI em coluna é ruim de todo
 * jeito, e vale migrar para acervo. Mas a tela deixa de pagar por eles.
 */

/** O que o retrato é, decidido pela forma do valor guardado. */
export type FormaDoRetrato =
    /** `data:image/png;base64,…` — bytes embutidos na coluna. */
    | { tipo: 'embutido'; mime: string; base64: string }
    /** `ref:classe:chave` ou `http…` — mora no acervo, resolve-se por endereço. */
    | { tipo: 'acervo'; valor: string }
    /** Não há foto. */
    | { tipo: 'nenhum' }

const DATA_URI = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i

/** Os tipos que aceitamos devolver. Nada de SVG — SVG é script. */
const MIMES_ACEITOS = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])

/**
 * Lê o valor guardado e diz o que ele é.
 *
 * Pura e total: qualquer coisa que não se reconheça vira `nenhum`, e `nenhum` é
 * um estado de primeira classe — é o caso em que o cartão mostra o nome, que é
 * o que o Andre pediu.
 *
 * **SVG é recusado de propósito.** Um `image/svg+xml` servido do nosso domínio
 * executa script no nosso domínio; o retrato que uma pessoa sobe não é lugar
 * para isso. Recusar aqui, e não na rota, é o que garante que nenhum chamador
 * futuro reabra o buraco.
 */
export function formaDoRetrato(valor: string | null | undefined): FormaDoRetrato {
    if (!valor) return { tipo: 'nenhum' }

    const casado = DATA_URI.exec(valor)
    if (casado) {
        const mime = casado[1].toLowerCase()
        if (!MIMES_ACEITOS.has(mime)) return { tipo: 'nenhum' }
        return { tipo: 'embutido', mime, base64: casado[2] }
    }

    if (valor.startsWith('ref:') || valor.startsWith('http')) {
        return { tipo: 'acervo', valor }
    }

    return { tipo: 'nenhum' }
}

/** Quem pode ter retrato. O plural na URL segue o resto da API. */
export type SujeitoDoRetrato = 'usuario' | 'agente'

/**
 * O endereço do retrato, ou `null` quando não há foto.
 *
 * `null` não é falha: é a informação de que o cartão deve escrever o nome.
 * Devolver um endereço que responde 404 faria cada cartão sem foto pagar uma
 * requisição para descobrir o que a lista já sabia.
 *
 * `v` é o `updatedAt` em base 36 — curto, monotônico e já existente nas duas
 * tabelas. Ele muda também quando outro campo da linha muda, e isso é aceitável:
 * o custo é um download a mais de vez em quando, contra a alternativa de hashear
 * 277 KB a cada montagem de lista.
 */
export function enderecoDoRetrato(
    sujeito: SujeitoDoRetrato,
    sujeitoId: string,
    avatar: string | null | undefined,
    atualizadoEm: Date | null | undefined
): string | null {
    if (formaDoRetrato(avatar).tipo === 'nenhum') return null
    const v = atualizadoEm ? atualizadoEm.getTime().toString(36) : '0'
    return `/api/retratos/${sujeito}/${encodeURIComponent(sujeitoId)}?v=${v}`
}

/**
 * O cabeçalho de cache da resposta.
 *
 * `private` porque o retrato é de gente da clínica e passa por autorização —
 * cache compartilhado guardaria a resposta de uma pessoa para servir a outra.
 * `immutable` com um ano é seguro **porque** a URL carrega `v`: o que é imutável
 * é aquele endereço, não a foto da pessoa.
 */
export const CACHE_DO_RETRATO = 'private, max-age=31536000, immutable'

/** Os bytes de um retrato embutido. Separado para a rota não decodificar à mão. */
export function bytesDoEmbutido(base64: string): Uint8Array {
    const bruto = atob(base64)
    const bytes = new Uint8Array(bruto.length)
    for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i)
    return bytes
}
