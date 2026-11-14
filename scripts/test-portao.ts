/**
 * O portão do agente — a prova do mutex.
 *
 * `isHumanHandled` decide se o agente fica calado. É a função mais perigosa
 * deste conjunto, porque os dois erros possíveis são silenciosos e opostos:
 *
 *   - **falso positivo** (dizer que a equipe assumiu quando não assumiu): o
 *     agente emudece. Nenhum erro em log, nenhuma exceção — só um paciente sem
 *     resposta. Foi o incidente de 03/11, e levou dias para ser notado.
 *   - **falso negativo** (dizer que ninguém assumiu quando alguém assumiu): o
 *     agente responde por cima da atendente. O paciente vê duas conversas
 *     dentro da mesma conversa.
 *
 * Nenhum dos dois aparece num `tsc` verde, e é por isso que esta prova existe
 * separada: ela afirma o contrato da função, não o formato dela.
 *
 * ## O que mudou, e o que esta prova trava
 *
 * Era `Boolean(assignedTo) || Boolean(handoffAt)`. Passou a ser
 * `atendidaPor === 'humano'`, e a troca foi o que permitiu ao rodízio escrever
 * `assignedTo` na chegada — antes, distribuir calaria o agente no ato de
 * distribuir, e era por isso que o responsável morava em `ownerId`, coluna que
 * a tela não lia (o defeito que o Andre relatou como "o lead entra, ganha um
 * responsável e não aparece no filtro minhas").
 *
 * A afirmação central, então, é a quarta: **conversa com responsável e portão
 * em `bot` NÃO cala o agente.** Se alguém reintroduzir `assignedTo` nesta
 * conta, ela reprova — e é exatamente o que precisa reprovar.
 */

import { isHumanHandled } from '@venn/core/trabalhos/servicos/conversation'

let ok = 0
let falhas = 0

function eq(nome: string, obtido: unknown, esperado: unknown) {
    if (obtido === esperado) {
        ok++
        console.log(`  ok  ${nome}`)
    } else {
        falhas++
        console.log(`  XX  ${nome}\n      esperado: ${esperado}\n      obtido:   ${obtido}`)
    }
}

console.log('\n— o agente fica calado? —\n')

eq('portão em humano: calado', isHumanHandled({ atendidaPor: 'humano' }), true)
eq('portão em bot: fala', isHumanHandled({ atendidaPor: 'bot' }), false)

/**
 * As quatro combinações do mundo real, escritas por extenso.
 *
 * O tipo da função só exige `atendidaPor`, então passar as outras colunas aqui
 * é deliberado: é assim que os chamadores a chamam (eles fazem `select` de
 * quatro ou cinco campos), e é a forma de afirmar que as outras **não contam**.
 */
const casos = [
    {
        nome: 'lead recém-chegado, distribuído pelo rodízio',
        conversa: { atendidaPor: 'bot', assignedTo: 'rachel', handoffAt: null },
        calado: false,
        porque: 'tem responsável, mas ninguém assumiu — o agente é quem atende',
    },
    {
        nome: 'lead recém-chegado, sem distribuição',
        conversa: { atendidaPor: 'bot', assignedTo: null, handoffAt: null },
        calado: false,
        porque: 'ninguém no caminho do agente',
    },
    {
        nome: 'atendente assumiu',
        conversa: { atendidaPor: 'humano', assignedTo: 'rachel', handoffAt: null },
        calado: true,
        porque: 'é o caso óbvio',
    },
    {
        nome: 'agente entregou à equipe e ninguém assumiu ainda',
        conversa: { atendidaPor: 'humano', assignedTo: null, handoffAt: new Date() },
        calado: true,
        porque: 'o agente já se despediu; falar de novo seria por cima da despedida',
    },
]

for (const c of casos) {
    eq(`${c.nome} → ${c.calado ? 'calado' : 'fala'}`, isHumanHandled(c.conversa), c.calado)
}

console.log('\n— as colunas antigas não decidem mais nada —\n')

/**
 * Estas duas são as que travam a regressão.
 *
 * Se alguém voltar a conjugar `assignedTo` ou `handoffAt` na função, uma das
 * duas reprova. A primeira é a que importa mais: é a conta que, feita errada,
 * emudece o agente em **toda** conversa que o rodízio distribuir — ou seja, em
 * praticamente todas, já que distribuir é o padrão das duas unidades de
 * produção.
 */
eq(
    '`assignedTo` preenchido não cala o agente por si',
    isHumanHandled({ atendidaPor: 'bot', assignedTo: 'rachel' } as { atendidaPor: string }),
    false
)
eq(
    '`handoffAt` preenchido não cala o agente por si',
    isHumanHandled({ atendidaPor: 'bot', handoffAt: new Date() } as { atendidaPor: string }),
    false
)

console.log('\n— valores que não deveriam existir —\n')

// Defensivo, e barato: o portão é texto no banco. Qualquer coisa que não seja
// exatamente "humano" deixa o agente falando, que é o lado seguro — paciente
// sem resposta é pior que resposta a mais.
for (const estranho of ['', 'Humano', 'HUMANO', 'bot ', 'desconhecido']) {
    eq(`"${estranho}" não é humano: o agente fala`, isHumanHandled({ atendidaPor: estranho }), false)
}

console.log(`\n${ok} ok, ${falhas} falhas\n`)
if (falhas) process.exit(1)
