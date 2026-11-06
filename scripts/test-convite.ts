/**
 * O convite com token: estado, validade e o sorteio.
 *
 *   npm run test:convite
 *
 * O estado é **derivado** de três instantes, e não uma coluna — é a decisão
 * central deste módulo. Uma coluna `estado` viraria mentira sozinha: um
 * convite gravado como "pendente" fica expirado quando o relógio passa, e nada
 * escreve na linha nesse instante. Os casos abaixo afirmam a precedência entre
 * os três instantes, que é o que uma coluna não teria.
 *
 * O "agora" é parâmetro em tudo, então nada aqui depende do relógio da máquina.
 */
import {
    VALIDADE_EM_DIAS,
    diasRestantes,
    estadoDoConvite,
    normalizarEmail,
    podeAceitar,
    podeReenviar,
    podeRevogar,
    vencimentoDe,
} from '@/lib/convite/estado'
import { pareceToken, resumoDoToken, sortearToken } from '@/lib/convite/token'

let passou = 0
let falhou = 0

function conferir(nome: string, real: unknown, esperado: unknown) {
    const a = JSON.stringify(real)
    const b = JSON.stringify(esperado)
    if (a === b) { passou++; console.log(`  ok  ${nome}`) }
    else { falhou++; console.log(`  XX  ${nome}\n        esperado: ${b}\n        veio:     ${a}`) }
}

const AGORA = new Date('2026-11-06T12:00:00Z')
const emDias = (d: number) => new Date(AGORA.getTime() + d * 86400000)

const conv = (p: Partial<Parameters<typeof estadoDoConvite>[0]> = {}) => ({
    expiresAt: emDias(7),
    acceptedAt: null,
    revokedAt: null,
    ...p,
})

console.log('\n— o estado, derivado de três instantes —\n')

conferir('recém-criado é pendente', estadoDoConvite(conv(), AGORA), 'pendente')
conferir('passou da validade é expirado', estadoDoConvite(conv({ expiresAt: emDias(-1) }), AGORA), 'expirado')
conferir('revogado é revogado', estadoDoConvite(conv({ revokedAt: emDias(-1) }), AGORA), 'revogado')
conferir('aceito é aceito', estadoDoConvite(conv({ acceptedAt: emDias(-1) }), AGORA), 'aceito')

console.log('\n— a precedência, que é o que uma coluna não teria —\n')

conferir(
    'ACEITO vence revogado: quem já entrou é da equipe',
    estadoDoConvite(conv({ acceptedAt: emDias(-2), revokedAt: emDias(-1) }), AGORA),
    'aceito'
)
conferir(
    'ACEITO vence expirado',
    estadoDoConvite(conv({ acceptedAt: emDias(-2), expiresAt: emDias(-1) }), AGORA),
    'aceito'
)
conferir(
    'REVOGADO vence expirado: é ato de gente, não do relógio',
    estadoDoConvite(conv({ revokedAt: emDias(-2), expiresAt: emDias(-1) }), AGORA),
    'revogado'
)
conferir(
    'vencer exatamente agora já é expirado',
    estadoDoConvite(conv({ expiresAt: AGORA }), AGORA),
    'expirado'
)

console.log('\n— o que cada estado permite —\n')

conferir('pendente aceita', podeAceitar(conv(), AGORA), true)
conferir('expirado NÃO aceita', podeAceitar(conv({ expiresAt: emDias(-1) }), AGORA), false)
conferir('revogado NÃO aceita', podeAceitar(conv({ revokedAt: emDias(-1) }), AGORA), false)
conferir('aceito NÃO aceita de novo (uso único)', podeAceitar(conv({ acceptedAt: emDias(-1) }), AGORA), false)

conferir('expirado PODE ser reenviado (alguém demorou)', podeReenviar(conv({ expiresAt: emDias(-1) }), AGORA), true)
conferir('revogado NÃO pode ser reenviado', podeReenviar(conv({ revokedAt: emDias(-1) }), AGORA), false)
conferir('aceito NÃO pode ser reenviado', podeReenviar(conv({ acceptedAt: emDias(-1) }), AGORA), false)

conferir('pendente pode ser revogado', podeRevogar(conv(), AGORA), true)
conferir('expirado pode ser revogado', podeRevogar(conv({ expiresAt: emDias(-1) }), AGORA), true)
conferir('aceito NÃO pode ser revogado (revogar não desliga ninguém)', podeRevogar(conv({ acceptedAt: emDias(-1) }), AGORA), false)

console.log('\n— validade e dias restantes —\n')

conferir(`validade padrão é ${VALIDADE_EM_DIAS} dias`, vencimentoDe(AGORA).toISOString(), emDias(7).toISOString())
conferir('3 dias inteiros restantes', diasRestantes(conv({ expiresAt: emDias(3) }), AGORA), 3)
conferir(
    'faltando 30 min arredonda para 1 — "expira hoje", não "em 0 dias"',
    diasRestantes(conv({ expiresAt: new Date(AGORA.getTime() + 30 * 60000) }), AGORA),
    1
)
conferir('já vencido é 0', diasRestantes(conv({ expiresAt: emDias(-1) }), AGORA), 0)

console.log('\n— o e-mail, digitado por duas pessoas diferentes —\n')

conferir('caixa e espaço normalizam', normalizarEmail('  Ana@Clinica.COM '), 'ana@clinica.com')
conferir('já normalizado não muda', normalizarEmail('ana@clinica.com'), 'ana@clinica.com')

console.log('\n— o token —\n')

const t1 = await sortearToken()
const t2 = await sortearToken()

conferir('o sorteio tem a forma do link', pareceToken(t1.token), true)
conferir('dois sorteios não colidem', t1.token === t2.token, false)
conferir('o resumo é estável', await resumoDoToken(t1.token), t1.tokenHash)
conferir('resumo tem 64 hex (SHA-256)', /^[0-9a-f]{64}$/.test(t1.tokenHash), true)
conferir('o resumo NÃO contém o token', t1.tokenHash.includes(t1.token), false)
conferir('token diferente, resumo diferente', t1.tokenHash === t2.tokenHash, false)
conferir('sem `+`, `/` ou `=` — passa em URL', /[+/=]/.test(t1.token), false)

conferir('link truncado não vai ao banco', pareceToken('undefined'), false)
conferir('vazio não vai ao banco', pareceToken(''), false)
conferir('nulo não vai ao banco', pareceToken(null), false)
conferir('caractere fora do alfabeto', pareceToken('abc$def' + 'a'.repeat(40)), false)
conferir('curto demais', pareceToken('abc'), false)

console.log(`\n${passou} ok, ${falhou} falhas\n`)
if (falhou > 0) process.exit(1)
