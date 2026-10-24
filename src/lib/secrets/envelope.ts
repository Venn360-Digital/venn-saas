import 'server-only'

/**
 * Cifra autenticada para segredo guardado no banco.
 *
 * Substitui o que a extensão de cofre da plataforma anterior fazia na VPS. O
 * Neon não tem essa extensão nem `pgsodium` — medido em `pg_available_extensions` do
 * projeto real em 2026-10-21 —, então a cifra sai do banco e passa a ser da
 * aplicação, com a chave **fora** do banco, em Cloudflare Secrets.
 *
 * Isto desfaz um impasse que estava escrito no próprio schema: o comentário de
 * `PlatformCredential.credentials` dizia que cifrar exigiria "uma chave que
 * viveria no ambiente que acabamos de esvaziar". Na VPS era verdade — o `.env`
 * era arquivo de texto no mesmo disco do banco, lido por quem tem root, ou
 * seja, por quem já lê o banco. Em Workers deixa de ser: o secret é cifrado em
 * repouso, não está no bundle e não está no repositório. A chave e o dado
 * cifrado passam a viver em lugares de verdade diferentes, que é a única coisa
 * que faz cifrar valer a pena.
 *
 * AES-256-GCM pelo WebCrypto, que é nativo em Workers e no Node 24 — nenhuma
 * dependência nova, e nada de `node:crypto`, que encareceria a ida a Workers.
 */

/** Nome do secret que guarda a chave. Nunca o valor. */
export const CHAVE_ENV = 'TOKEN_ENCRYPTION_KEY'

/**
 * O envelope gravado na coluna.
 *
 * `v` existe para que a rotação de chave não exija parada: ao trocar a chave,
 * sobe-se a versão, passa-se a escrever na nova e a leitura continua aceitando
 * a antiga até a reescrita terminar.
 */
export interface Envelope {
    v: 1
    /** Nonce de 12 bytes, base64. Novo a cada gravação — reusar nonce em GCM quebra a cifra. */
    iv: string
    /** Texto cifrado com a tag de autenticação no fim, base64. */
    ct: string
}

export class ChaveAusenteError extends Error {
    constructor() {
        super(`${CHAVE_ENV} não está definida; segredos cifrados não podem ser lidos nem gravados`)
        this.name = 'ChaveAusenteError'
    }
}

export class EnvelopeInvalidoError extends Error {
    constructor(motivo: string) {
        super(`envelope de segredo inválido: ${motivo}`)
        this.name = 'EnvelopeInvalidoError'
    }
}

function base64Para(bytes: ArrayBuffer | Uint8Array): string {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    let s = ''
    for (const b of u8) s += String.fromCharCode(b)
    return btoa(s)
}

function deBase64(texto: string): Uint8Array<ArrayBuffer> {
    const bin = atob(texto)
    // Sobre um ArrayBuffer explícito: o `Uint8Array` genérico do TS admite
    // `SharedArrayBuffer`, que o WebCrypto não aceita em `BufferSource`.
    const u8 = new Uint8Array(new ArrayBuffer(bin.length))
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    return u8
}

/**
 * A chave importada, uma vez por isolate.
 *
 * `importKey` é barato, mas acontece em todo pedido que toca uma integração;
 * guardar o `CryptoKey` evita repetir. O material em claro não fica retido: só o
 * handle, que é o que o WebCrypto expõe.
 */
/**
 * O tipo da chave, **derivado** da própria API em vez de nomeado.
 *
 * `CryptoKey` é um nome global que vem de `lib.dom` ou de `lib.webworker`, e o
 * `tsconfig` do processo `workers/` carrega só `["ES2022"]` — então nomeá-lo
 * quebrava `npm run typecheck:workers`, que é o que este módulo tem de
 * atravessar: ele é usado pelo app Next, pelo worker em Node e, depois do corte,
 * pelo Worker da Cloudflare. `crypto.subtle` está tipado nos três; o nome do
 * tipo de retorno não está em todos. Derivar é o que funciona em todos.
 */
type ChaveCripto = Awaited<ReturnType<typeof crypto.subtle.importKey>>

let chaveCache: { material: string; chave: Promise<ChaveCripto> } | null = null

function chave(): Promise<ChaveCripto> {
    const material = process.env[CHAVE_ENV]?.trim()
    if (!material) throw new ChaveAusenteError()

    if (chaveCache?.material === material) return chaveCache.chave

    const bytes = deBase64(material)
    if (bytes.length !== 32) {
        throw new EnvelopeInvalidoError(
            `${CHAVE_ENV} tem ${bytes.length} bytes depois do base64; AES-256 exige 32`
        )
    }

    const chavePromise = crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt',
    ])
    chaveCache = { material, chave: chavePromise }
    return chavePromise
}

/** Cifra um valor. O envelope resultante é seguro para gravar no banco. */
export async function cifrar(valor: string): Promise<Envelope> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        await chave(),
        new TextEncoder().encode(valor)
    )
    return { v: 1, iv: base64Para(iv), ct: base64Para(ct) }
}

/**
 * Decifra um envelope.
 *
 * Lança se a chave estiver errada ou o dado tiver sido alterado — GCM autentica,
 * então adulteração não passa por engano. Quem chama trata como "não
 * configurado", nunca como "valor vazio": a diferença entre essas duas coisas é
 * a diferença entre pedir a credencial de novo e falhar silenciosamente.
 */
export async function decifrar(envelope: unknown): Promise<string> {
    if (!ehEnvelope(envelope)) throw new EnvelopeInvalidoError('formato não reconhecido')

    const claro = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: deBase64(envelope.iv) },
        await chave(),
        deBase64(envelope.ct)
    )
    return new TextDecoder().decode(claro)
}

/** Se o JSON lido da coluna é um envelope desta versão. */
export function ehEnvelope(valor: unknown): valor is Envelope {
    if (typeof valor !== 'object' || valor === null) return false
    const e = valor as Record<string, unknown>
    return e.v === 1 && typeof e.iv === 'string' && typeof e.ct === 'string'
}

/**
 * Gera material de chave novo, em base64, para colar no `wrangler secret put`.
 *
 * Fica aqui e não num script solto porque é a única forma correta de produzir
 * essa chave, e porque a função que cifra é a que deve dizer o que ela aceita.
 */
export function gerarChave(): string {
    return base64Para(crypto.getRandomValues(new Uint8Array(32)))
}
