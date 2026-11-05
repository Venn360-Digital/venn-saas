/**
 * As condições e a ação que fechavam as lacunas das Regras de ação.
 *
 *   npm run test:condicoes
 *
 * Três lacunas levantadas ao mapear a tela de Parametrização:
 *
 *   - **não existia "primeira mensagem"**, e ela não dá para escrever com tempo
 *     decorrido — que é justamente *indefinido* na primeira mensagem, porque não
 *     há mensagem anterior. Quem quisesse reagir à abertura do atendimento não
 *     tinha como.
 *   - **não existia "fora do expediente"**, a condição que a clínica mais pede:
 *     mensagem que chega às 22h não pode ser atendida como se fosse meio-dia.
 *   - **não existia "encerrar atendimento"**, então a mensagem que não precisa
 *     de atendimento ("obrigado", "era só isso") ou consumia uma resposta do
 *     agente ou ficava aberta até o cron de `autoCloseDays` varrer, trinta dias
 *     depois.
 *
 * O que este arquivo prova é a parte que decide, e ela é pura: a janela é texto
 * e número, e o avaliador recebe o instante **pelo contexto** — então a hora é
 * fixada aqui em vez de depender do relógio de quem roda.
 */
import { dentroDaJanela, descreverJanela, normalizarJanela } from '@/lib/rules/expediente'
import { RuleEvaluator } from '@/lib/rules/evaluator'
import type { RuleContext } from '@/types/rules'

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

console.log('\nA janela de expediente')

const JAN = { inicio: '08:00', fim: '18:00', dias: [1, 2, 3, 4, 5] }

conferir('dentro da janela, em dia de semana', dentroDaJanela('09:30', 3, JAN), true)
conferir('o início é inclusivo', dentroDaJanela('08:00', 3, JAN), true)
conferir(
    'o fim é EXCLUSIVO — 18:00 em ponto já está fora de uma janela que fecha às 18:00',
    dentroDaJanela('18:00', 3, JAN),
    false
)
conferir('um minuto antes do fim ainda está dentro', dentroDaJanela('17:59', 3, JAN), true)
conferir('antes de abrir está fora', dentroDaJanela('07:59', 3, JAN), false)
conferir('domingo está fora, mesmo na hora certa', dentroDaJanela('09:30', 0, JAN), false)
conferir('sábado está fora, mesmo na hora certa', dentroDaJanela('09:30', 6, JAN), false)
conferir(
    'clínica que abre sábado: basta a janela dizer',
    dentroDaJanela('09:30', 6, { ...JAN, dias: [1, 2, 3, 4, 5, 6] }),
    true
)

console.log('\nJanela malformada não dispara — nem no "fora de"')

conferir('objeto vazio não é janela', normalizarJanela({}), null)
conferir('hora fora do formato não é janela', normalizarJanela({ inicio: '8h', fim: '18:00', dias: [1] }), null)
conferir('hora inexistente não é janela', normalizarJanela({ inicio: '25:00', fim: '26:00', dias: [1] }), null)
conferir(
    'janela invertida é recusada — aceitá-la faria "fora do expediente" valer o dia inteiro',
    normalizarJanela({ inicio: '18:00', fim: '08:00', dias: [1] }),
    null
)
conferir('início igual ao fim é recusado', normalizarJanela({ inicio: '08:00', fim: '08:00', dias: [1] }), null)
conferir('texto não é janela', normalizarJanela('08:00-18:00'), null)
conferir('nulo não é janela', normalizarJanela(null), null)
conferir(
    'dias repetidos e fora de ordem são normalizados',
    normalizarJanela({ inicio: '08:00', fim: '18:00', dias: [5, 1, 1, 9, -1, 3] }),
    { inicio: '08:00', fim: '18:00', dias: [1, 3, 5] }
)
conferir(
    'sem dias é janela válida que nunca está dentro',
    dentroDaJanela('09:30', 3, { inicio: '08:00', fim: '18:00', dias: [] }),
    false
)
conferir(
    'o resumo da tela diz dias e horas',
    descreverJanela({ inicio: '08:00', fim: '12:00', dias: [1, 6] }),
    'seg, sáb 08:00–12:00'
)

console.log('\nAs condições, pelo avaliador')

const avaliador = new RuleEvaluator()

/** Quarta-feira, 2026-10-28, 09:30 em Brasília (12:30 UTC). */
const QUARTA_0930 = new Date('2026-10-28T12:30:00Z')
/** Mesma quarta, 20:30 em Brasília (23:30 UTC) — fora do expediente. */
const QUARTA_2030 = new Date('2026-10-28T23:30:00Z')
/** Domingo, 2026-11-01, 09:30 em Brasília. */
const DOMINGO_0930 = new Date('2026-11-01T12:30:00Z')

const ctx = (extra: Partial<RuleContext> = {}): RuleContext => ({
    workspaceId: 'w',
    agentId: 'a',
    conversationId: 'c',
    contactId: 'p',
    message: 'oi',
    ...extra,
})

/** Uma condição só, sem ação: o que se mede aqui é o `evaluate`. */
const so = (c: unknown) => ({ conditions: [c], actions: [] }) as never

conferir(
    'fora do expediente: 20:30 de quarta dispara',
    avaliador.evaluate(
        so({ type: 'business_hours', operator: 'outside', value: JAN }),
        ctx({ agora: QUARTA_2030 })
    ),
    true
)
conferir(
    'fora do expediente: 09:30 de quarta NÃO dispara',
    avaliador.evaluate(
        so({ type: 'business_hours', operator: 'outside', value: JAN }),
        ctx({ agora: QUARTA_0930 })
    ),
    false
)
conferir(
    'fora do expediente: domingo dispara mesmo em horário comercial',
    avaliador.evaluate(
        so({ type: 'business_hours', operator: 'outside', value: JAN }),
        ctx({ agora: DOMINGO_0930 })
    ),
    true
)
conferir(
    'dentro do expediente é o espelho',
    avaliador.evaluate(
        so({ type: 'business_hours', operator: 'inside', value: JAN }),
        ctx({ agora: QUARTA_0930 })
    ),
    true
)
conferir(
    'sem instante no contexto, a condição de horário não dispara',
    avaliador.evaluate(so({ type: 'business_hours', operator: 'outside', value: JAN }), ctx()),
    false
)
/**
 * O MESMO instante, julgado por duas unidades em fusos diferentes.
 *
 * Este é o par que prova que o expediente deixou de ser o de Brasília. As
 * 23:30Z de quarta são 20:30 em São Paulo — fora da janela 08–18 — e 10:30 da
 * manhã de **quinta** em Sydney, dentro dela. Antes do fuso por unidade os dois
 * respondiam igual, porque o fuso era constante.
 */
conferir(
    'fora do expediente: 23:30Z é noite em São Paulo, logo dispara',
    avaliador.evaluate(
        so({ type: 'business_hours', operator: 'outside', value: JAN }),
        ctx({ agora: QUARTA_2030, fuso: 'America/Sao_Paulo' })
    ),
    true
)
conferir(
    'o mesmo instante é manhã de quinta em Sydney, logo NÃO dispara',
    avaliador.evaluate(
        so({ type: 'business_hours', operator: 'outside', value: JAN }),
        ctx({ agora: QUARTA_2030, fuso: 'Australia/Sydney' })
    ),
    false
)
conferir(
    'e o "dentro de" é o espelho, no fuso de lá',
    avaliador.evaluate(
        so({ type: 'business_hours', operator: 'inside', value: JAN }),
        ctx({ agora: QUARTA_2030, fuso: 'Australia/Sydney' })
    ),
    true
)
conferir(
    'contexto sem fuso cai no padrão do sistema, como antes',
    avaliador.evaluate(
        so({ type: 'business_hours', operator: 'outside', value: JAN }),
        ctx({ agora: QUARTA_2030 })
    ),
    avaliador.evaluate(
        so({ type: 'business_hours', operator: 'outside', value: JAN }),
        ctx({ agora: QUARTA_2030, fuso: 'America/Sao_Paulo' })
    )
)

conferir(
    'janela malformada não dispara no "fora de" — é a regra mais perigosa de todas',
    avaliador.evaluate(
        so({
            type: 'business_hours',
            operator: 'outside',
            value: { inicio: '18:00', fim: '08:00', dias: [1] },
        }),
        ctx({ agora: QUARTA_2030 })
    ),
    false
)

conferir(
    'primeira mensagem: dispara na primeira',
    avaliador.evaluate(
        so({ type: 'first_message', operator: 'equals', value: true }),
        ctx({ isFirstMessage: true })
    ),
    true
)
conferir(
    'primeira mensagem: não dispara nas seguintes',
    avaliador.evaluate(
        so({ type: 'first_message', operator: 'equals', value: true }),
        ctx({ isFirstMessage: false })
    ),
    false
)
conferir(
    '"não é a primeira" é o espelho, e serve para quem volta',
    avaliador.evaluate(
        so({ type: 'first_message', operator: 'equals', value: false }),
        ctx({ isFirstMessage: false })
    ),
    true
)
conferir(
    'valor em texto atravessa o JSON e continua valendo',
    avaliador.evaluate(
        so({ type: 'first_message', operator: 'equals', value: 'sim' }),
        ctx({ isFirstMessage: true })
    ),
    true
)
conferir(
    'sem o campo no contexto, a condição de primeira mensagem não dispara',
    avaliador.evaluate(so({ type: 'first_message', operator: 'equals', value: true }), ctx()),
    false
)

/**
 * Os dois tipos que saíram da **gravação** continuam sem disparar na avaliação.
 *
 * Regra antiga com eles existe no banco e não é reescrita por ninguém; o que
 * mudou é que não nasce mais nenhuma. Se um dia o avaliador passasse a tratá-los
 * como verdadeiros, toda regra inerte gravada acordaria de uma vez.
 */
conferir(
    'user_intent continua inerte',
    avaliador.evaluate(so({ type: 'user_intent', operator: 'contains', value: 'preco' }), ctx()),
    false
)
conferir(
    'custom continua inerte',
    avaliador.evaluate(so({ type: 'custom', operator: 'equals', value: 'x' }), ctx()),
    false
)

console.log('\nE as condições antigas seguem valendo')

conferir(
    'a mensagem contém, com lista de variações',
    avaliador.evaluate(
        so({ type: 'message_contains', operator: 'contains', value: ['preço', 'valor'] }),
        ctx({ message: 'qual o VALOR do aparelho?' })
    ),
    true
)
conferir(
    'E lógico: horário fora + palavra, só dispara com as duas',
    avaliador.evaluate(
        {
            conditions: [
                { type: 'business_hours', operator: 'outside', value: JAN },
                { type: 'message_contains', operator: 'contains', value: 'urgente' },
            ],
            actions: [],
        } as never,
        ctx({ agora: QUARTA_2030, message: 'é urgente' })
    ),
    true
)
conferir(
    'E lógico: a mesma regra não dispara dentro do expediente',
    avaliador.evaluate(
        {
            conditions: [
                { type: 'business_hours', operator: 'outside', value: JAN },
                { type: 'message_contains', operator: 'contains', value: 'urgente' },
            ],
            actions: [],
        } as never,
        ctx({ agora: QUARTA_0930, message: 'é urgente' })
    ),
    false
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
