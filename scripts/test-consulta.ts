/**
 * Os casos da consulta ao Cérebro.
 *
 *   npm run test:consulta
 *
 * `montarConsulta` é função pura de propósito. É ela que decide **o que o agente
 * consegue encontrar** na base de conhecimento, e o modo de falha dela é
 * silencioso: busca vazia não dá erro, dá um atendimento sem preço e sem
 * serviço, com o agente respondendo normalmente. Foi assim que a nota de voz
 * atravessou o lançamento procurando no acervo pela string "🎵 Áudio".
 */
import { montarConsulta, textoParaBusca } from '@venn/core/lib/rag/consulta'
import { ehMarcadorDeMidia } from '@venn/core/lib/whatsapp/payload'

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

const entra = (content: string, extra: Record<string, unknown> = {}) => ({
    direction: 'inbound',
    content,
    contentType: 'text',
    transcript: null,
    ...extra,
})
const sai = (content: string) => ({ direction: 'outbound', content, contentType: 'text' })

console.log('\nMarcadores — a lista vive em payload.ts, numa definição só')

conferir('"🎵 Áudio" é marcador', ehMarcadorDeMidia('🎵 Áudio'), true)
conferir('"📷 Imagem" é marcador', ehMarcadorDeMidia('📷 Imagem'), true)
conferir('"🏷️ Sticker" é marcador', ehMarcadorDeMidia('🏷️ Sticker'), true)
conferir('documento é marcador pelo prefixo', ehMarcadorDeMidia('📄 orcamento.pdf'), true)
conferir('localização é marcador pelo prefixo', ehMarcadorDeMidia('📍 Localização: -19.9, -43.9'), true)
conferir('contato é marcador pelo prefixo', ehMarcadorDeMidia('👤 Contato: Maria'), true)
conferir('vazio conta como marcador', ehMarcadorDeMidia('   '), true)
conferir('legenda de verdade NÃO é marcador', ehMarcadorDeMidia('olha meu dente'), false)

console.log('\nÁudio — o defeito que motivou isto')

conferir(
    'áudio vale pela transcrição, não pelo marcador',
    textoParaBusca(entra('🎵 Áudio', { contentType: 'audio', transcript: 'quanto custa um implante?' })),
    'quanto custa um implante?'
)

conferir(
    'áudio sem transcrição não vale nada (e não procura pelo marcador)',
    textoParaBusca(entra('🎵 Áudio', { contentType: 'audio', transcript: null })),
    ''
)

conferir(
    'uma conversa que termina em áudio busca pela fala',
    montarConsulta([
        entra('oi'),
        sai('Olá! Como posso ajudar?'),
        entra('🎵 Áudio', { contentType: 'audio', transcript: 'preciso de um canal, quanto fica?' }),
    ]),
    'preciso de um canal, quanto fica?\noi'
)

conferir(
    'áudio sem transcrição cai no contexto anterior em vez de buscar vazio',
    montarConsulta([
        entra('quero colocar aparelho'),
        entra('🎵 Áudio', { contentType: 'audio', transcript: null }),
    ]),
    'quero colocar aparelho'
)

console.log('\nPergunta curta — "e quanto custa?" sem assunto')

conferir(
    'a pergunta curta recebe o que a pessoa já disse',
    montarConsulta([
        entra('quero colocar aparelho'),
        sai('Claro! Temos ortodontia.'),
        entra('e quanto custa?'),
    ]),
    'e quanto custa?\nquero colocar aparelho'
)

conferir(
    'a pergunta atual vem PRIMEIRO, para dominar o vetor',
    montarConsulta([entra('implante'), entra('qual o valor?')]).split('\n')[0],
    'qual o valor?'
)

conferir(
    'o que o agente respondeu NUNCA entra',
    montarConsulta([
        entra('oi'),
        sai('Fazemos ortodontia, implante e clareamento a partir de R$ 180'),
        entra('e o preço?'),
    ]),
    'e o preço?\noi'
)

const longa =
    'Bom dia, eu gostaria de saber se vocês atendem pelo convênio Amil e qual ' +
    'seria o valor de uma avaliação completa com radiografia panorâmica incluída.'
conferir(
    'pergunta longa se explica sozinha e não recebe contexto',
    montarConsulta([entra('oi'), entra(longa)]),
    longa
)

conferir(
    'pergunta de 149 caracteres também se explica (foi o caso que baixou o limiar)',
    montarConsulta([entra('oi'), entra(longa)]).includes('\noi'),
    false
)

conferir(
    '"oi" repetido não gasta o orçamento três vezes, e a ordem é do mais recente',
    montarConsulta([entra('oi'), entra('oi'), entra('aparelho'), entra('oi'), entra('valor?')]),
    'valor?\noi\naparelho'
)

console.log('\nBordas')

conferir('histórico vazio devolve consulta vazia', montarConsulta([]), '')
conferir('só mensagem do agente devolve vazia', montarConsulta([sai('Olá!')]), '')
conferir(
    'só mídia sem legenda devolve vazia (nada a procurar)',
    montarConsulta([entra('📷 Imagem', { contentType: 'image' })]),
    ''
)
conferir(
    'nota interna da equipe não entra',
    montarConsulta([entra('aparelho'), entra('nota da equipe', { isInternal: true }), entra('valor?')]),
    'valor?\naparelho'
)
conferir(
    'imagem COM legenda entra normalmente',
    montarConsulta([entra('olha meu dente quebrado', { contentType: 'image' })]),
    'olha meu dente quebrado'
)

/**
 * O caso que o interruptor "Manter contexto" criava, e que esta prova trava.
 *
 * Desligado, o histórico ia ao modelo como `take: 1` — a última mensagem **de
 * qualquer direção**. Quando essa era do agente (a saudação `initialMessage`, ou
 * uma mensagem gravada por regra), o filtro de `inbound` daqui esvaziava a lista
 * e a consulta saía `''`: **busca sem nada e prompt sem a fala do paciente**.
 *
 * O interruptor saiu, então o histórico vem inteiro. Estes dois casos garantem
 * que, com o fio inteiro, a última mensagem ser do agente não apaga a pergunta.
 */
console.log('\nÚltima mensagem do agente não pode apagar a pergunta')

conferir(
    'agente falou por último: a pergunta do paciente segue valendo',
    montarConsulta([entra('quanto custa clareamento?'), sai('Oi! Sou a Ana, como posso ajudar?')]),
    'quanto custa clareamento?'
)
conferir(
    'só o agente falou: não há pergunta, e a consulta é vazia',
    montarConsulta([sai('Oi! Sou a Ana, como posso ajudar?')]),
    ''
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
