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
import { msisdnDoJid, toMsisdn } from '@/lib/whatsapp/types'

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

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
