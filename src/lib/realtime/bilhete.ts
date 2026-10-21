/**
 * O bilhete que abre o socket do tempo real.
 *
 * **Por que existe um bilhete, em vez de autorizar no próprio handshake.**
 * Quem pode assinar o WebSocket é o Durable Object da sala, e chegar nele exige
 * um *binding* — ou seja, código do Worker, fora do contexto de requisição do
 * Next. Mas resolver participação em workspace é obrigação de um lugar só
 * (`lib/auth/workspace.ts`), e `scripts/lint-workspace.mjs` reprova o build se
 * aparecer outro. E `usuarioDaSessao()` depende de `next/headers`, que não
 * existe no `fetch` do Worker.
 *
 * Então são duas etapas, cada uma onde pode acontecer:
 *
 *   1. uma rota do Next autoriza de verdade — sessão, participação, papel — e
 *      devolve este bilhete;
 *   2. o `fetch` do Worker **verifica a assinatura** e encaminha para a sala,
 *      sem consultar banco nenhum.
 *
 * O segundo passo não pode consultar banco: é o caminho de um socket por aba
 * aberta, e uma consulta de participação por conexão pagaria uma conexão de
 * Postgres para cada reconexão de rede de cada atendente.
 *
 * Validade curta de propósito — o bilhete serve para **abrir** o socket, não
 * para mantê-lo. Sessão revogada derruba a próxima reconexão, não a atual; é o
 * mesmo recorte que o cookie de sessão já tem.
 */

/** Trinta segundos: tempo de abrir o socket, não de guardar para depois. */
export const VALIDADE_SEGUNDOS = 30

export interface DadosDoBilhete {
    workspaceId: string
    usuarioId: string
}

export class BilheteInvalidoError extends Error {
    readonly motivo: string

    constructor(motivo: string) {
        super(`bilhete inválido: ${motivo}`)
        this.name = 'BilheteInvalidoError'
        this.motivo = motivo
    }
}

type Chave = Awaited<ReturnType<typeof crypto.subtle.importKey>>

async function chaveDe(segredo: string): Promise<Chave> {
    return crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(segredo),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
    )
}

/** Base64 sem `+`, `/` nem `=`, para caber em query string sem escapar. */
function paraBase64Url(bytes: Uint8Array): string {
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function deBase64Url(texto: string): Uint8Array<ArrayBuffer> {
    const normal = texto.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(normal + '='.repeat((4 - (normal.length % 4)) % 4))
    const u8 = new Uint8Array(new ArrayBuffer(bin.length))
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    return u8
}

/**
 * `<corpo>.<assinatura>`, onde o corpo é base64url de JSON.
 *
 * **O corpo é assinado, não cifrado.** base64 é codificação: quem tem o
 * bilhete lê o workspace e o usuário decodificando. Isso é aceitável porque
 * quem tem o bilhete é **a própria pessoa autorizada**, que já conhece o
 * próprio workspace — o que o HMAC garante é integridade, não sigilo.
 *
 * Então nunca ponha segredo aqui dentro: nada que o portador não possa ver.
 */
export async function assinar(
    dados: DadosDoBilhete,
    segredo: string,
    agoraMs = Date.now()
): Promise<string> {
    if (!segredo) throw new Error('bilhete: segredo ausente')

    const corpo = paraBase64Url(
        new TextEncoder().encode(
            JSON.stringify({
                w: dados.workspaceId,
                u: dados.usuarioId,
                exp: Math.floor(agoraMs / 1000) + VALIDADE_SEGUNDOS,
            })
        )
    )

    const assinatura = await crypto.subtle.sign(
        'HMAC',
        await chaveDe(segredo),
        new TextEncoder().encode(corpo)
    )

    return `${corpo}.${paraBase64Url(new Uint8Array(assinatura))}`
}

/**
 * Verifica e devolve os dados. Lança `BilheteInvalidoError`.
 *
 * A verificação da assinatura vem **antes** de olhar o conteúdo: olhar primeiro
 * e verificar depois é como se aceita um corpo adulterado por descuido de
 * ordem. E usa `crypto.subtle.verify`, que compara em tempo constante — uma
 * comparação de strings vazaria a assinatura byte a byte.
 */
export async function verificar(
    bilhete: string,
    segredo: string,
    agoraMs = Date.now()
): Promise<DadosDoBilhete> {
    if (!segredo) throw new Error('bilhete: segredo ausente')

    const ponto = bilhete.indexOf('.')
    if (ponto <= 0 || ponto === bilhete.length - 1) {
        throw new BilheteInvalidoError('formato')
    }

    const corpo = bilhete.slice(0, ponto)
    const assinatura = bilhete.slice(ponto + 1)

    let confere: boolean
    try {
        confere = await crypto.subtle.verify(
            'HMAC',
            await chaveDe(segredo),
            deBase64Url(assinatura),
            new TextEncoder().encode(corpo)
        )
    } catch {
        throw new BilheteInvalidoError('assinatura ilegível')
    }

    if (!confere) throw new BilheteInvalidoError('assinatura')

    let lido: unknown
    try {
        lido = JSON.parse(new TextDecoder().decode(deBase64Url(corpo)))
    } catch {
        throw new BilheteInvalidoError('corpo ilegível')
    }

    if (typeof lido !== 'object' || lido === null) throw new BilheteInvalidoError('corpo')
    const d = lido as Record<string, unknown>

    if (typeof d.exp !== 'number' || d.exp * 1000 <= agoraMs) {
        throw new BilheteInvalidoError('vencido')
    }
    if (typeof d.w !== 'string' || !d.w) throw new BilheteInvalidoError('workspace')
    if (typeof d.u !== 'string' || !d.u) throw new BilheteInvalidoError('usuário')

    return { workspaceId: d.w, usuarioId: d.u }
}

/**
 * O segredo com que o bilhete é assinado.
 *
 * Derivado do `BETTER_AUTH_SECRET` com **separação de domínio** — o prefixo —
 * em vez de um segredo novo. Duas razões, nesta ordem:
 *
 * - um segredo a mais é uma coisa a mais para o André configurar, esquecer de
 *   rotacionar e descobrir faltando no corte;
 * - reusar a mesma chave crua em dois protocolos é o erro clássico: uma
 *   assinatura emitida para um propósito passa a valer no outro. O prefixo
 *   torna as duas chaves computacionalmente independentes, e custa uma
 *   concatenação.
 */
export function segredoDoBilhete(): string {
    const base = process.env.BETTER_AUTH_SECRET
    if (!base) throw new Error('BETTER_AUTH_SECRET ausente: o tempo real não pode autorizar')
    return `tempo-real:v1:${base}`
}
