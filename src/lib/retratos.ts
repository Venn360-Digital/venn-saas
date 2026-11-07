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
import { CLASSES } from '@/lib/storage/classificacao'
import { comoReferencia } from '@/lib/midia'
import { gravar } from '@/lib/storage'

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
 * O endereço do retrato. **Sempre existe, mesmo sem foto.**
 *
 * ## Por que deixou de receber o valor da coluna
 *
 * A primeira versão recebia `avatar` e devolvia `null` quando não havia foto,
 * para o cartão escrever o nome sem gastar uma requisição. Parecia economia e
 * era o contrário: para saber se havia foto, **toda** consulta de lista tinha
 * de trazer a coluna — e a coluna guarda a foto inteira. Medido em produção
 * (2026-11-07): 275 kB em dois usuários, ~40% da tabela `users`. Cada carga da
 * lista de conversas, do painel de equipe e de `/api/auth/me` arrastava esses
 * bytes do Neon até o Worker **para produzir um booleano**.
 *
 * Agora o endereço sai de `id` + `updatedAt`, que são baratos, e quem decide se
 * há foto é a **rota**, que precisa dos bytes de todo jeito para servi-los.
 * Nenhuma lista precisa mais da coluna.
 *
 * Quem não tem foto recebe 404 — e o 404 vem com cabeçalho de cache, então o
 * navegador não repergunta. O componente `Retrato` desenha o nome primeiro e só
 * revela a imagem quando ela carrega, então não há piscada nem imagem quebrada.
 *
 * `v` é o `updatedAt` em base 36: curto, monotônico, e muda quando a foto muda.
 * Muda também quando outro campo da linha muda, e isso é aceitável — o custo é
 * um download a mais de vez em quando, contra hashear a foto a cada lista.
 */
export function enderecoDoRetrato(
    sujeito: SujeitoDoRetrato,
    sujeitoId: string,
    atualizadoEm: Date | null | undefined
): string {
    const v = atualizadoEm ? atualizadoEm.getTime().toString(36) : '0'
    return `/api/retratos/${sujeito}/${encodeURIComponent(sujeitoId)}?v=${v}`
}

/**
 * O cabeçalho do 404 — "esta pessoa não tem foto", e não reperguntar tão cedo.
 *
 * Uma hora, e não um ano como o do retrato que existe: quem põe uma foto hoje
 * quer vê-la hoje. Uma hora é o bastante para a lista parar de bater na rota a
 * cada carregamento, e pouco para a espera incomodar quem acabou de subir a
 * foto — que, de todo modo, muda o `v` e vira outro endereço.
 */
export const CACHE_DO_SEM_RETRATO = 'private, max-age=3600'

/**
 * O cabeçalho de cache da resposta.
 *
 * `private` porque o retrato é de gente da clínica e passa por autorização —
 * cache compartilhado guardaria a resposta de uma pessoa para servir a outra.
 * `immutable` com um ano é seguro **porque** a URL carrega `v`: o que é imutável
 * é aquele endereço, não a foto da pessoa.
 */
export const CACHE_DO_RETRATO = 'private, max-age=31536000, immutable'

/**
 * Os bytes de um retrato embutido. Separado para a rota não decodificar à mão.
 *
 * O tipo é `Uint8Array<ArrayBuffer>` e não o genérico `Uint8Array` porque é o
 * que `gravar` exige — ele precisa de um buffer que sabe ser transferível, e
 * `ArrayBufferLike` inclui `SharedArrayBuffer`, que não é. Construir sobre um
 * `ArrayBuffer` explícito satisfaz os dois usos sem conversão em quem chama.
 */
export function bytesDoEmbutido(base64: string): Uint8Array<ArrayBuffer> {
    const bruto = atob(base64)
    const bytes = new Uint8Array(new ArrayBuffer(bruto.length))
    for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i)
    return bytes
}

/**
 * A chave do retrato no acervo. Determinística, e é isso que a torna útil.
 *
 * `<workspaceId>/retratos/<sujeito>/<id>.<ext>` — trocar a foto sobrescreve a
 * mesma chave em vez de acumular lixo, e o cache do navegador é furado pelo `v`
 * do endereço (o `updatedAt`), não pelo nome do arquivo. O oposto — chave
 * aleatória por upload — deixaria a foto antiga no bucket para sempre, sem
 * ninguém apontando para ela.
 *
 * O `workspaceId` na frente porque é assim que o resto do acervo é organizado,
 * e porque facilita apagar tudo de uma unidade quando for o caso.
 */
export function chaveDoRetrato(
    workspaceId: string,
    sujeito: SujeitoDoRetrato,
    sujeitoId: string,
    mime: string
): string {
    const ext = mime === 'image/jpeg' ? 'jpg' : mime.replace('image/', '')
    return `${workspaceId}/retratos/${sujeito}/${sujeitoId}.${ext}`
}

/**
 * Guarda o retrato no acervo e devolve a referência para a coluna.
 *
 * ## Por que a coluna deixa de receber os bytes
 *
 * Era `data:image/png;base64,…` gravado direto em `users.avatar` — o único
 * lugar do produto que ainda fazia isso (anexo de conversa e foto de contato já
 * vão para o acervo há tempo). O custo foi medido: 275 kB em dois usuários, e
 * um deles com 277.026 bytes numa coluna que meia dúzia de consultas traziam
 * para decidir um booleano.
 *
 * **Consertar a fonte vem antes de migrar o acervado.** Sem isto, a migração
 * seria esteira: cada pessoa que trocasse a foto repunha um data URI.
 *
 * ## O que acontece quando o acervo recusa
 *
 * Devolve `null`, e quem chama decide. Para o perfil, a decisão certa é
 * **falhar o pedido** em vez de gravar o data URI como antes: aceitar o
 * fallback silencioso traria de volta exatamente o que esta função existe para
 * tirar, e ninguém notaria até a tabela crescer de novo.
 */
export async function guardarRetrato(entrada: {
    workspaceId: string
    sujeito: SujeitoDoRetrato
    sujeitoId: string
    /** O `data:` que a tela mandou. Outra coisa é devolvida como está. */
    valor: string
}): Promise<{ referencia: string } | null> {
    const forma = formaDoRetrato(entrada.valor)

    // Já é referência ou URL: nada a fazer, e devolver o próprio valor é o
    // caminho por onde um PATCH que não mexeu na foto passa sem reescrevê-la.
    if (forma.tipo === 'acervo') return { referencia: entrada.valor }
    if (forma.tipo === 'nenhum') return null

    const bytes = bytesDoEmbutido(forma.base64)
    const chave = chaveDoRetrato(
        entrada.workspaceId,
        entrada.sujeito,
        entrada.sujeitoId,
        forma.mime
    )

    try {
        const ref = await gravar(CLASSES.PUBLICO, chave, bytes, { contentType: forma.mime })
        return { referencia: comoReferencia(ref) }
    } catch (erro) {
        console.error('[RETRATO] não deu para arquivar', erro)
        return null
    }
}
