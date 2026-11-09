import 'server-only'

/**
 * A verificação da assinatura do Amazon SNS.
 *
 * ## Por que isto não é opcional
 *
 * O webhook de recibos é **público** — tem de ser, porque quem chama é a AWS e
 * não um usuário logado. Sem conferir a assinatura, qualquer pessoa que
 * descubra a URL pode postar um "Complaint" falso e nós:
 *
 * - marcamos o contato como opt-out de e-mail,
 * - pedimos ao SES para **suprimir** o endereço na conta inteira.
 *
 * Ou seja: um POST forjado descadastra pacientes de qualquer clínica, em
 * silêncio, e a clínica só descobre quando a campanha seguinte sair pela
 * metade. É o tipo de dano que não deixa rastro de invasão.
 *
 * ## Como o SNS assina
 *
 * O SNS monta uma string canônica com um subconjunto fixo de campos, em ordem
 * alfabética, cada um como `nome\nvalor\n`, e assina com a chave privada do
 * certificado que ele publica em `SigningCertURL`. `SignatureVersion` 1 usa
 * SHA1; a 2, SHA256.
 *
 * **Os campos assinados mudam com o tipo da mensagem** — `Notification` tem
 * `Subject` (quando presente) e não tem `SubscribeURL`; os dois tipos de
 * confirmação têm `SubscribeURL` e `Token`. Usar a lista errada dá assinatura
 * que nunca bate, e o sintoma é "o webhook recusa tudo".
 */

/** Os tipos de mensagem que o SNS entrega numa assinatura HTTPS. */
export type TipoDeMensagemSns =
    | 'Notification'
    | 'SubscriptionConfirmation'
    | 'UnsubscribeConfirmation'

export interface MensagemDoSns {
    Type: TipoDeMensagemSns
    MessageId: string
    TopicArn: string
    Message: string
    Timestamp: string
    SignatureVersion: string
    Signature: string
    SigningCertURL: string
    Subject?: string
    SubscribeURL?: string
    Token?: string
}

/**
 * Os campos que entram na string canônica, por tipo.
 *
 * Ordem alfabética, e é ela que vale — não a ordem em que vieram no JSON.
 */
const CAMPOS_ASSINADOS: Record<TipoDeMensagemSns, string[]> = {
    Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
    SubscriptionConfirmation: [
        'Message',
        'MessageId',
        'SubscribeURL',
        'Timestamp',
        'Token',
        'TopicArn',
        'Type',
    ],
    UnsubscribeConfirmation: [
        'Message',
        'MessageId',
        'SubscribeURL',
        'Timestamp',
        'Token',
        'TopicArn',
        'Type',
    ],
}

/**
 * O certificado só pode vir da AWS.
 *
 * Sem esta checagem a verificação é teatro: quem forja a mensagem escolhe
 * também o `SigningCertURL`, publica o próprio certificado, assina com a
 * própria chave privada — e a assinatura **bate**. É a falha clássica desta
 * integração, e ela passa em qualquer teste que use mensagens legítimas.
 *
 * Exige HTTPS, host `sns.<regiao>.amazonaws.com` (ou `.amazonaws.com.cn`), e
 * caminho de `.pem`.
 */
export function certificadoConfiavel(url: string): boolean {
    let alvo: URL
    try {
        alvo = new URL(url)
    } catch {
        return false
    }

    if (alvo.protocol !== 'https:') return false
    if (!alvo.pathname.endsWith('.pem')) return false

    return /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(alvo.hostname)
}

/** A string canônica que o SNS assinou. */
function stringCanonica(m: MensagemDoSns): string | null {
    const campos = CAMPOS_ASSINADOS[m.Type]
    if (!campos) return null

    let saida = ''
    for (const campo of campos) {
        const valor = (m as unknown as Record<string, unknown>)[campo]
        // `Subject` é opcional: ausente, sai da string inteira — não entra
        // vazio. Entrar vazio faz a assinatura não bater em toda notificação
        // sem assunto, que são quase todas.
        if (valor === undefined || valor === null) continue
        saida += `${campo}\n${String(valor)}\n`
    }
    return saida
}

/** Converte um PEM em bytes DER, que é o que o WebCrypto importa. */
function derDoPem(pem: string): Uint8Array | null {
    const corpo = pem
        .replace(/-----BEGIN CERTIFICATE-----/, '')
        .replace(/-----END CERTIFICATE-----/, '')
        .replace(/\s+/g, '')
    if (corpo.length === 0) return null
    try {
        const bin = atob(corpo)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        return bytes
    } catch {
        return null
    }
}

/**
 * Extrai a chave pública RSA de um certificado X.509 em DER.
 *
 * O WebCrypto não importa certificado — só chave (`spki`). Então é preciso
 * achar, dentro do DER, onde começa o `SubjectPublicKeyInfo`.
 *
 * **Sem parser de ASN.1 completo, de propósito.** O que se procura é a
 * sequência de bytes do OID `rsaEncryption` (1.2.840.113549.1.1.1), que marca o
 * início do `AlgorithmIdentifier` dentro do SPKI; dali se volta até o `SEQUENCE`
 * que o envolve. É estreito e funciona para o certificado do SNS, que é sempre
 * RSA — e trazer uma biblioteca de ASN.1 para o bundle do Worker por causa de
 * uma rota custaria mais do que entrega.
 */
function chavePublicaDoCertificado(der: Uint8Array): Uint8Array | null {
    // 30 0D 06 09 2A 86 48 86 F7 0D 01 01 01 05 00
    //  = SEQUENCE { OID rsaEncryption, NULL }
    const marca = [
        0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05,
        0x00,
    ]

    for (let i = 0; i + marca.length <= der.length; i++) {
        let bate = true
        for (let j = 0; j < marca.length; j++) {
            if (der[i + j] !== marca[j]) {
                bate = false
                break
            }
        }
        if (!bate) continue

        /**
         * Achada a marca, o SPKI é o `SEQUENCE` que começa **antes** dela. O
         * cabeçalho tem 4 bytes (`30 82 len_hi len_lo`) para os comprimentos
         * que um RSA 2048 produz.
         */
        const inicio = i - 4
        if (inicio < 0 || der[inicio] !== 0x30 || der[inicio + 1] !== 0x82) continue

        const comprimento = (der[inicio + 2] << 8) | der[inicio + 3]
        const fim = inicio + 4 + comprimento
        if (fim > der.length) continue

        return der.slice(inicio, fim)
    }

    return null
}

/**
 * Busca o certificado, com cache por URL.
 *
 * O SNS usa o mesmo certificado por semanas. Buscá-lo a cada evento somaria uma
 * ida à rede em cada recibo — e são até nove por e-mail enviado.
 *
 * O cache é do isolate e morre com ele, o que é a validade certa: não há o que
 * invalidar, porque a chave do cache **é** a URL, e um certificado novo vem com
 * URL nova.
 */
const certificados = new Map<string, Promise<string | null>>()

async function buscarCertificado(url: string): Promise<string | null> {
    const guardado = certificados.get(url)
    if (guardado) return guardado

    const promessa = fetch(url)
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null)

    certificados.set(url, promessa)

    const pem = await promessa
    // Falha não fica no cache: a próxima tentativa deve ir à rede de novo.
    if (pem === null) certificados.delete(url)
    return pem
}

/**
 * Confere a assinatura. `false` em qualquer dúvida.
 *
 * Nunca lança: esta função decide se um POST público é confiável, e uma exceção
 * aqui viraria 500 — que para quem está sondando é informação, e para o SNS é
 * motivo de reentrega infinita.
 */
export async function assinaturaDoSnsValida(m: MensagemDoSns): Promise<boolean> {
    try {
        if (!certificadoConfiavel(m.SigningCertURL)) return false

        const canonica = stringCanonica(m)
        if (canonica === null) return false

        const pem = await buscarCertificado(m.SigningCertURL)
        if (!pem) return false

        const der = derDoPem(pem)
        if (!der) return false

        const spki = chavePublicaDoCertificado(der)
        if (!spki) return false

        // Versão 1 assina com SHA1; a 2, com SHA256. O SNS ainda manda 1 por
        // padrão em tópico antigo, então os dois precisam valer.
        const hash = m.SignatureVersion === '2' ? 'SHA-256' : 'SHA-1'

        const chave = await crypto.subtle.importKey(
            'spki',
            spki.slice().buffer as ArrayBuffer,
            { name: 'RSASSA-PKCS1-v1_5', hash },
            false,
            ['verify']
        )

        const assinatura = Uint8Array.from(atob(m.Signature), (c) => c.charCodeAt(0))

        return await crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            chave,
            assinatura.slice().buffer as ArrayBuffer,
            new TextEncoder().encode(canonica)
        )
    } catch {
        return false
    }
}

/** Lê o corpo cru como mensagem do SNS, sem confiar em nada ainda. */
export function lerMensagemDoSns(cru: string): MensagemDoSns | null {
    try {
        const valor: unknown = JSON.parse(cru)
        if (typeof valor !== 'object' || valor === null) return null
        const m = valor as Partial<MensagemDoSns>
        if (
            m.Type !== 'Notification' &&
            m.Type !== 'SubscriptionConfirmation' &&
            m.Type !== 'UnsubscribeConfirmation'
        ) {
            return null
        }
        if (
            typeof m.MessageId !== 'string' ||
            typeof m.TopicArn !== 'string' ||
            typeof m.Signature !== 'string' ||
            typeof m.SigningCertURL !== 'string'
        ) {
            return null
        }
        return m as MensagemDoSns
    } catch {
        return null
    }
}
