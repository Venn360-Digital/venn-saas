/**
 * O JID do WhatsApp, e quando ele é um telefone.
 *
 *   npm run test:jid
 *
 * O defeito que estes casos travam foi medido em produção em 2026-11-13. Alguém
 * digitou um celular real na tela de novo atendimento e a tela respondeu:
 *
 *     Tem WhatsApp. Novo na base — será cadastrado ao confirmar.
 *     No WhatsApp ele é 4526996250761 — é assim que fica salvo.
 *
 * `4526996250761` não é telefone de lugar nenhum: era o **LID**, o identificador
 * que o WhatsApp usa para endereçar contas sem expor o número. `toMsisdn` tira o
 * sufixo de qualquer JID, então o LID virava "telefone" — dígitos plausíveis e
 * nada mais —, e o cadastro nasceria com ele no lugar do número.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import {
    ehDestinoEnviavel,
    ehJidDeLid,
    lidDoJid,
    msisdnDoJid,
    telefoneAlternativoNoInfo,
    toMsisdn,
} from '@venn/core/lib/whatsapp/types'
import { nomeDoCanalPodeEntrar } from '@venn/core/trabalhos/servicos/conversation'

let passou = 0
let falhou = 0

function conferir(nome: string, real: unknown, esperado: unknown) {
    const a = JSON.stringify(real)
    const b = JSON.stringify(esperado)
    if (a === b) {
        passou++
        console.log(`  ok  ${nome}`)
    } else {
        falhou++
        console.log(`  XX  ${nome}\n        esperado: ${b}\n        veio:     ${a}`)
    }
}

console.log('\nO caso medido em produção')

conferir(
    'LID NÃO é telefone — é o defeito inteiro numa linha',
    msisdnDoJid('4526996250761@lid'),
    null
)
conferir(
    'e `toMsisdn` continua devolvendo os dígitos: é por isso que ela não serve aqui',
    toMsisdn('4526996250761@lid'),
    '4526996250761'
)

console.log('\nO que É telefone')

conferir('JID comum', msisdnDoJid('5531999223375@s.whatsapp.net'), '5531999223375')
conferir('com sufixo de dispositivo', msisdnDoJid('5511999999999:38@s.whatsapp.net'), '5511999999999')
conferir('forma antiga c.us', msisdnDoJid('553188501161@c.us'), '553188501161')
conferir('sem sufixo nenhum é aceito — já vem só o número', msisdnDoJid('5531999223375'), '5531999223375')

/**
 * O número sem o nono dígito continua passando: foi um defeito anterior desta
 * mesma função (contas antigas são endereçadas pela forma curta), e o conserto
 * do LID não pode desfazê-lo.
 */
conferir('o nono dígito ausente não é recusado', msisdnDoJid('553188501161@s.whatsapp.net'), '553188501161')

console.log('\nO que NÃO é telefone')

conferir('grupo', msisdnDoJid('120363042123456789@g.us'), null)
conferir('lista de transmissão', msisdnDoJid('status@broadcast'), null)
conferir('newsletter', msisdnDoJid('120363000000000000@newsletter'), null)
conferir('LID com sufixo de dispositivo também', msisdnDoJid('4526996250761:12@lid'), null)
conferir('maiúsculas no servidor não enganam', msisdnDoJid('4526996250761@LID'), null)

console.log('\nAusência e lixo')

conferir('nulo', msisdnDoJid(null), null)
conferir('indefinido', msisdnDoJid(undefined), null)
conferir('vazio', msisdnDoJid(''), null)
conferir('só espaço', msisdnDoJid('   '), null)
conferir('JID sem dígito nenhum', msisdnDoJid('abc@s.whatsapp.net'), null)

console.log('\nO LID como identidade própria')

conferir('reconhece LID', ehJidDeLid('109315692208342@lid'), true)
conferir('telefone não é LID', ehJidDeLid('5531988501161@s.whatsapp.net'), false)
conferir('grupo não é LID', ehJidDeLid('123@g.us'), false)
conferir('LID cru, sem sufixo', lidDoJid('109315692208342@lid'), '109315692208342')
conferir('LID com dispositivo normaliza', lidDoJid('109315692208342:12@lid'), '109315692208342')
conferir('telefone não devolve LID', lidDoJid('5531988501161@s.whatsapp.net'), null)

console.log('\nO telefone do par, achado pela FORMA e não pelo nome do campo')

conferir(
    'SenderAlt',
    telefoneAlternativoNoInfo({ Chat: '1@lid', SenderAlt: '5531988702912@s.whatsapp.net' }),
    '5531988702912'
)
conferir(
    'RecipientAlt — nome diferente, mesma forma',
    telefoneAlternativoNoInfo({ Chat: '1@lid', RecipientAlt: '553191420149@c.us' }),
    '553191420149'
)
conferir(
    'nenhum campo de telefone: nulo, e quem chama fica com o LID',
    telefoneAlternativoNoInfo({ Chat: '1@lid', Sender: '1@lid', PushName: 'Marcia' }),
    null
)
conferir(
    'texto solto com dígitos não passa por telefone',
    telefoneAlternativoNoInfo({ Chat: '1@lid', PushName: '5531988702912' }),
    null
)

console.log('\nPara onde dá para enviar')

conferir('telefone brasileiro', ehDestinoEnviavel('5531988501161', 'whatsapp_qr'), true)
conferir('vazio nunca', ehDestinoEnviavel('', 'whatsapp_qr'), false)
conferir('nulo nunca', ehDestinoEnviavel(null, 'whatsapp_qr'), false)
conferir('IGSID vale no Instagram', ehDestinoEnviavel('17841400000000000', 'instagram'), true)
// O tamanho NÃO separa LID de telefone — a separação é na coluna, acima. Esta
// prova existe para que ninguém tente separá-los aqui e recuse um estrangeiro.
conferir('quinze dígitos passam: o E.164 os admite', ehDestinoEnviavel('123456789012345', 'whatsapp_qr'), true)

console.log('\nO nome: o canal preenche, não corrige')

const fichaVazia = { name: null, phone: '5531988501161', lid: null, instagramId: null }
const fichaAuto = { name: 'WhatsApp 5531988501161', phone: '5531988501161', lid: null, instagramId: null }
const fichaDaClinica = {
    name: 'Fátima Rodrigues — indicação da Dra. Ana',
    phone: '5531988501161',
    lid: null,
    instagramId: null,
}

conferir('ficha sem nome recebe o do perfil', nomeDoCanalPodeEntrar(fichaVazia, 'Fátima'), true)
conferir('nome que nós geramos é substituído', nomeDoCanalPodeEntrar(fichaAuto, 'Fátima'), true)
conferir(
    'nome digitado pela recepção NÃO é reescrito',
    nomeDoCanalPodeEntrar(fichaDaClinica, 'Fátima'),
    false
)
conferir(
    'nome provisório de lead sem número é substituído',
    nomeDoCanalPodeEntrar(
        { name: 'Lead sem número identificado', phone: null, lid: '109315692208342', instagramId: null },
        'Marcia'
    ),
    true
)
conferir(
    'nome automático com o LID também é substituído',
    nomeDoCanalPodeEntrar(
        { name: 'WhatsApp 109315692208342', phone: null, lid: '109315692208342', instagramId: null },
        'Marcia'
    ),
    true
)
conferir('perfil sem nome não apaga o que existe', nomeDoCanalPodeEntrar(fichaDaClinica, ''), false)
conferir('perfil igual ao nome atual não gera escrita', nomeDoCanalPodeEntrar(fichaAuto, 'WhatsApp 5531988501161'), false)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
