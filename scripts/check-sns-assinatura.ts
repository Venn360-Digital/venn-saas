/**
 * Prova a verificação de assinatura do SNS contra um certificado X.509 real.
 *
 *     npx tsx --conditions=react-server scripts/check-sns-assinatura.ts
 *
 * Gera o proprio par de chaves e o certificado com `openssl` num diretorio
 * temporario, que e apagado no fim. Sem argumento, sem arquivo para manter, e
 * sem chave de teste esquecida no repositorio.
 *
 * ## O risco que isto fecha
 *
 * `assinaturaDoSnsValida` precisa tirar a chave pública de dentro de um
 * certificado X.509, porque o WebCrypto não importa certificado — só
 * `SubjectPublicKeyInfo`. O extrator (`chavePublicaDoCertificado`) acha o OID
 * `rsaEncryption` nos bytes DER e recua até o `SEQUENCE` que o envolve, sem um
 * parser de ASN.1 completo.
 *
 * Se esse atalho não funcionar num certificado real, a função devolve `false`
 * para **tudo** — e o webhook recusa 100% dos recibos. Fail-closed, então nada
 * se corrompe; mas também nada chega, e de fora o sintoma é "as métricas de
 * campanha não aparecem", sem erro em lugar nenhum.
 *
 * O certificado é gerado por `openssl req -x509 -newkey rsa:2048` — o mesmo
 * formato que a AWS publica.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createSign } from 'node:crypto'

import { assinaturaDoSnsValida, type MensagemDoSns } from '@venn/core/lib/email/sns'

/**
 * Um certificado RSA 2048 de brinquedo, no mesmo formato que a AWS publica.
 *
 * Gerado na hora e apagado no fim: chave de teste commitada vira chave de teste
 * usada, e o que importa aqui e o **formato**, nao o valor.
 */
const dir = mkdtempSync(join(tmpdir(), 'check-sns-'))
const caminhoCert = join(dir, 'cert.pem')
const caminhoChave = join(dir, 'cert.key')

try {
    execFileSync(
        'openssl',
        [
            'req', '-x509', '-newkey', 'rsa:2048',
            '-keyout', caminhoChave, '-out', caminhoCert,
            '-days', '1', '-nodes',
            '-subj', '/CN=sns.us-east-2.amazonaws.com',
        ],
        { stdio: 'ignore' }
    )
} catch {
    console.error('openssl nao esta disponivel; esta prova precisa dele para gerar o certificado.')
    rmSync(dir, { recursive: true, force: true })
    process.exit(1)
}

const pem = readFileSync(caminhoCert, 'utf8')
const chavePrivada = readFileSync(caminhoChave, 'utf8')

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

/**
 * O certificado é servido de um host fingido de SNS.
 *
 * `assinaturaDoSnsValida` busca o `SigningCertURL` pela rede, e a URL tem de
 * passar na validação de host. Em vez de subir um servidor, troca-se o `fetch`
 * global — o que também deixa explícito que a função **só** busca a URL que
 * aprovou.
 */
const URL_DO_CERT = 'https://sns.us-east-2.amazonaws.com/SimpleNotificationService-teste.pem'
let urlsBuscadas: string[] = []

globalThis.fetch = (async (entrada: unknown) => {
    const url = String(entrada)
    urlsBuscadas.push(url)
    if (url === URL_DO_CERT) return new Response(pem, { status: 200 })
    return new Response('não encontrado', { status: 404 })
}) as typeof fetch

/** Monta a string canônica como o SNS monta, e assina com a chave privada. */
function assinarComo(m: Omit<MensagemDoSns, 'Signature'>): string {
    const campos =
        m.Type === 'Notification'
            ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
            : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']

    let canonica = ''
    for (const campo of campos) {
        const valor = (m as unknown as Record<string, unknown>)[campo]
        if (valor === undefined || valor === null) continue
        canonica += `${campo}\n${String(valor)}\n`
    }

    const algoritmo = m.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1'
    return createSign(algoritmo).update(canonica, 'utf8').sign(chavePrivada, 'base64')
}

function notificacao(extra: Partial<MensagemDoSns> = {}): Omit<MensagemDoSns, 'Signature'> {
    return {
        Type: 'Notification',
        MessageId: 'sns-msg-1',
        TopicArn: 'arn:aws:sns:us-east-2:264081376201:venn-odontobox',
        Message: '{"eventType":"Delivery","mail":{"messageId":"m1","destination":["a@b.com"]}}',
        Timestamp: '2026-11-08T12:00:00.000Z',
        SignatureVersion: '1',
        SigningCertURL: URL_DO_CERT,
        ...extra,
    }
}

async function main() {
    console.log('── A chave sai mesmo de um certificado X.509 real ──')

    // SHA1 (SignatureVersion 1) — ainda o padrão de tópico antigo.
    const v1 = notificacao()
    ok('assinatura válida, SHA1, passa', await assinaturaDoSnsValida({ ...v1, Signature: assinarComo(v1) }))

    // SHA256 (SignatureVersion 2).
    const v2 = notificacao({ SignatureVersion: '2' })
    ok('assinatura válida, SHA256, passa', await assinaturaDoSnsValida({ ...v2, Signature: assinarComo(v2) }))

    // Com Subject, que entra na string canônica quando existe.
    const comAssunto = notificacao({ Subject: 'Amazon SES Email Event Notification' })
    ok(
        'com Subject passa',
        await assinaturaDoSnsValida({ ...comAssunto, Signature: assinarComo(comAssunto) })
    )

    console.log('')
    console.log('── E recusa o que tem de recusar ──')

    /**
     * Corpo adulterado com assinatura legítima.
     *
     * É o ataque de verdade: pegar uma notificação real e trocar o `Message`
     * por um "Complaint" forjado. Se a assinatura fosse conferida contra o
     * corpo reserializado, ou não fosse conferida, isto passaria.
     */
    const original = notificacao()
    const assinaturaOriginal = assinarComo(original)
    ok(
        'Message adulterado é recusado',
        !(await assinaturaDoSnsValida({
            ...original,
            Message: '{"eventType":"Complaint","mail":{"messageId":"m1","destination":["vitima@exemplo.com"]},"complaint":{}}',
            Signature: assinaturaOriginal,
        }))
    )

    ok(
        'assinatura inventada é recusada',
        !(await assinaturaDoSnsValida({ ...original, Signature: Buffer.from('nao-e-assinatura').toString('base64') }))
    )

    /**
     * O ataque do certificado próprio.
     *
     * O atacante assina com a chave DELE e aponta o `SigningCertURL` para o
     * certificado DELE. A assinatura bate — o que recusa é a validação do host.
     */
    urlsBuscadas = []
    const certAlheio = notificacao({ SigningCertURL: 'https://invasor.com/cert.pem' })
    ok(
        'certificado de outro host é recusado',
        !(await assinaturaDoSnsValida({ ...certAlheio, Signature: assinarComo(certAlheio) }))
    )
    ok(
        'e o host alheio nem chega a ser buscado',
        urlsBuscadas.length === 0,
        urlsBuscadas.join(',') || '(nenhuma busca)'
    )

    ok(
        'TopicArn trocado é recusado',
        !(await assinaturaDoSnsValida({
            ...original,
            TopicArn: 'arn:aws:sns:us-east-2:999999999999:outro',
            Signature: assinaturaOriginal,
        }))
    )

    console.log('')
    if (falhas > 0) {
        console.log(`${falhas} FALHA(S)`)
        process.exitCode = 1
    } else {
        console.log('tudo passou')
    }
}

void main().finally(() => rmSync(dir, { recursive: true, force: true }))
