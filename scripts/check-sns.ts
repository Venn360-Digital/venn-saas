/**
 * Prova a verificação de assinatura do SNS e a leitura dos recibos do SES.
 *
 *     npx tsx --conditions=react-server scripts/check-sns.ts
 *
 * Sem banco, sem rede, sem Cloudflare: gera um par de chaves, monta um
 * certificado X.509 de brinquedo, assina mensagens como o SNS assinaria, e
 * confere que as válidas passam e as forjadas não.
 *
 * ## Por que isto existe
 *
 * `/api/webhooks/ses` é **pública** — quem chama é a AWS, não um usuário
 * logado. Um POST forjado que passe pela verificação marca contatos como
 * opt-out e pede ao SES para suprimir endereços da conta inteira: descadastra
 * pacientes de qualquer clínica, em silêncio. O defeito não deixa rastro, e
 * aparece só quando a campanha seguinte sai pela metade.
 *
 * O caso que mais importa é o do **certificado de outro host**: quem forja a
 * mensagem escolhe também o `SigningCertURL`, e se esse campo não for
 * validado ele publica o próprio certificado, assina com a própria chave e a
 * assinatura **bate**. É a falha clássica desta integração, e ela passa em
 * qualquer teste feito só com mensagens legítimas.
 */
import { certificadoConfiavel } from '../src/lib/email/sns'
import {
    avanca,
    lerEventoDoSes,
    pedeSupressao,
    statusDoEvento,
} from '../src/lib/email/eventos'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

// ═════════════════════════ o host do certificado ═════════════════════════

console.log('── O certificado só pode vir da AWS ──')

ok(
    'aceita o host real do SNS',
    certificadoConfiavel('https://sns.us-east-2.amazonaws.com/SimpleNotificationService-abc.pem')
)
ok('aceita a região da China', certificadoConfiavel('https://sns.cn-north-1.amazonaws.com.cn/x.pem'))

/**
 * Cada um destes é um jeito de parecer a AWS sem ser.
 *
 * O quarto é o mais traiçoeiro: `sns.us-east-2.amazonaws.com.invasor.com` tem
 * o host legítimo como **prefixo**, e passa em qualquer checagem que use
 * `includes` ou `startsWith` em vez de ancorar a expressão.
 */
for (const [rotulo, url] of [
    ['sem HTTPS', 'http://sns.us-east-2.amazonaws.com/x.pem'],
    ['host alheio', 'https://invasor.com/x.pem'],
    ['subdomínio forjado', 'https://sns.us-east-2.amazonaws.com.invasor.com/x.pem'],
    ['amazonaws sem ser sns', 'https://s3.us-east-2.amazonaws.com/x.pem'],
    ['credencial no host', 'https://sns.us-east-2.amazonaws.com@invasor.com/x.pem'],
    ['não é .pem', 'https://sns.us-east-2.amazonaws.com/x.txt'],
    ['vazio', ''],
    ['lixo', 'nao-e-url'],
] as const) {
    ok(`recusa ${rotulo}`, !certificadoConfiavel(url), url.slice(0, 50))
}

// ═════════════════════════ a leitura dos recibos ═════════════════════════

console.log('')
console.log('── Os recibos do SES ──')

const envelope = (tipo: string, extra: Record<string, unknown>) =>
    JSON.stringify({
        eventType: tipo,
        mail: {
            messageId: 'msg-1',
            timestamp: '2026-11-08T12:00:00.000Z',
            destination: ['alguem@exemplo.com'],
        },
        ...extra,
    })

ok('lê uma entrega', lerEventoDoSes(envelope('Delivery', { delivery: {} }))?.tipo === 'Delivery')
ok('lê uma abertura', lerEventoDoSes(envelope('Open', { open: {} }))?.tipo === 'Open')

const bounceDuro = lerEventoDoSes(
    envelope('Bounce', {
        bounce: {
            bounceType: 'Permanent',
            bounceSubType: 'NoEmail',
            bouncedRecipients: [{ emailAddress: 'nao-existe@exemplo.com' }],
        },
    })
)
ok('bounce permanente é duro', bounceDuro?.bounceDuro === true)
ok(
    'e o destinatário é o que quicou, não todos do envio',
    bounceDuro?.destinatarios[0] === 'nao-existe@exemplo.com',
    bounceDuro?.destinatarios.join(',')
)

/**
 * O caso que separa "caixa cheia" de "endereço não existe".
 *
 * Tratar os dois como falha final descadastraria quem só estava de férias com
 * a caixa lotada — e o contato se perde para sempre por causa de uma semana.
 */
const bounceMole = lerEventoDoSes(
    envelope('Bounce', { bounce: { bounceType: 'Transient', bounceSubType: 'MailboxFull' } })
)
ok('bounce transitório NÃO é duro', bounceMole?.bounceDuro === false)
ok('e não pede supressão', !pedeSupressao(bounceMole!))
ok('e não vira falha final', statusDoEvento(bounceMole!) === null)

ok('bounce duro pede supressão', pedeSupressao(bounceDuro!))
ok('e vira falha', statusDoEvento(bounceDuro!) === 'failed')

const reclamacao = lerEventoDoSes(
    envelope('Complaint', {
        complaint: { complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: 'a@b.com' }] },
    })
)
ok('reclamação pede supressão', pedeSupressao(reclamacao!))

ok('descarta corpo que não é JSON', lerEventoDoSes('mensagem de teste do console') === null)
ok('descarta JSON sem messageId', lerEventoDoSes('{"eventType":"Delivery","mail":{}}') === null)

// ═════════════════════════ o estado não anda para trás ═════════════════════

console.log('')
console.log('── O status só sobe ──')

/**
 * A ordem de entrega do SNS **não é garantida**.
 *
 * Um `Delivery` atrasado chegando depois de um `Open` rebaixaria o
 * destinatário de "lido" para "entregue", e o relatório ficaria pior quanto
 * mais a rede demorasse — defeito que só aparece sob carga.
 */
ok('sent → delivered sobe', avanca('sent', 'delivered'))
ok('delivered → read sobe', avanca('delivered', 'read'))
ok('read → delivered NÃO rebaixa', !avanca('read', 'delivered'))
ok('failed → delivered NÃO rebaixa', !avanca('failed', 'delivered'))
ok('read → read não repete', !avanca('read', 'read'))

console.log('')
if (falhas > 0) {
    console.log(`${falhas} FALHA(S)`)
    process.exitCode = 1
} else {
    console.log('tudo passou')
}
