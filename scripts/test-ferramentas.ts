/**
 * Provas do contrato das ferramentas do agente.
 *
 * ## Por que isto existe, e por que só agora
 *
 * As ferramentas são a única parte do sistema em que **o modelo escolhe o que
 * chamar**, e ele escolhe pelo NOME. O nome é API: se ele muda, o modelo pede
 * uma ferramenta que não existe e `runAgentTool` devolve
 * `Erro: a ferramenta "X" não existe` — ao cliente final, no WhatsApp.
 *
 * Medido em 15/11/2026, antes de renomear qualquer uma: dos 230 testes que
 * exercitam o agente (`test:prompt`, `test:cenarios`, `test:escalada`,
 * `test:juiz`, `test:fusao`), **nenhum toca `AGENT_TOOL_DEFINITIONS` nem
 * `runAgentTool`**. Os nomes podiam ser trocados por engano e nada reprovaria.
 *
 * ## A asserção que trava o desenho
 *
 * "Nenhum nome de ferramenta contém palavra do nicho." Ela existe porque a
 * alternativa — nome montado com o vocabulário — faria a API do agente
 * depender da configuração de uma unidade: alguém troca "paciente" por
 * "cliente" nas Configurações e o nome da ferramenta muda em produção, no meio
 * de conversas abertas. Nome é identificador estável; descrição é texto.
 *
 *     pnpm run test:ferramentas
 */
import './lib/marca-de-teste.ts'

import { AGENT_TOOL_DEFINITIONS } from '@venn/core/trabalhos/servicos/agent-tools'

let passou = 0
let falhou = 0

function ok(nome: string, condicao: boolean, detalhe = '') {
    console.log(`  ${condicao ? 'ok ' : 'FALHOU'} ${nome}${detalhe ? `  — ${detalhe}` : ''}`)
    if (condicao) passou++
    else falhou++
}

const defs = AGENT_TOOL_DEFINITIONS()

console.log('\nO conjunto existe e tem forma')
ok('há ferramentas declaradas', defs.length > 0, `${defs.length}`)
ok(
    'nenhum nome repetido',
    new Set(defs.map((d) => d.name)).size === defs.length,
    defs.map((d) => d.name).join(', ')
)
for (const d of defs) {
    ok(`"${d.name}" tem descrição não vazia`, typeof d.description === 'string' && d.description.trim().length > 20)
}

console.log('\nO nome é identificador estável: snake_case, sem acento, sem espaço')
for (const d of defs) {
    ok(`"${d.name}" é snake_case ASCII`, /^[a-z][a-z0-9_]*$/.test(d.name))
}

console.log('\nNenhum NOME carrega palavra do nicho — nome é API, não texto')
/*
 * A lista é do primeiro nicho de propósito: é dele que os nomes vinham. Um
 * eixo novo no vocabulário não precisa entrar aqui — o que esta regra protege é
 * o nome ser FIXO, e qualquer palavra de nicho num nome indica que alguém o
 * montou com o vocabulário.
 */
/*
 * A lista é DADO sobre o nicho, não identificador — e um renomeio em massa de
 * identificador a tocou em 15/11/2026, trocando `especialista` por
 * `profissional` e `procedimento` por `servico` **aqui dentro**. A regra passou
 * a proibir exatamente os termos neutros, e os dois testes de parâmetro
 * reprovaram apontando `servico, profissional` como se fossem o problema.
 *
 * É a sexta forma de "literal que não é o que parece" desta fase: não é texto
 * que o usuário lê, nem identificador do código — é dado sobre o domínio. Quem
 * pegou foi o próprio teste, reprovando de um jeito que não fazia sentido, o
 * que é o melhor desfecho possível.
 */
const DO_NICHO = /paciente|clinica|cl[íi]nica|especialista|procedimento|dentista|consultorio|consult[óo]rio/i
for (const d of defs) {
    ok(`"${d.name}" não cita o nicho`, !DO_NICHO.test(d.name))
}

console.log('\nAs DESCRIÇÕES, ao contrário, usam o vocabulário da marca de teste')
/*
 * A marca de teste diz "pessoa", "profissional", "serviço" — então uma
 * descrição que ainda esteja presa ao primeiro nicho aparece aqui. É o mesmo
 * critério do `lint-vocabulario`, exercido no objeto já montado em vez de no
 * texto do arquivo: aqui prova que a interpolação realmente aconteceu.
 */
const comNicho = defs.filter((d) => DO_NICHO.test(d.description ?? ''))
ok(
    'nenhuma descrição presa ao primeiro nicho',
    comNicho.length === 0,
    comNicho.length ? comNicho.map((d) => d.name).join(', ') : `${defs.length} conferidas`
)

console.log('\nOs nomes dos PARÂMETROS também são API, e também são fixos')
/*
 * O modelo manda `{"servico": "Limpeza"}` — a chave é contrato tanto quanto o
 * nome da ferramenta. Montá-la com o vocabulário faria o JSON que o modelo
 * precisa produzir depender da configuração de uma unidade.
 */
for (const d of defs) {
    const props = Object.keys(((d.parameters as { properties?: Record<string, unknown> })?.properties) ?? {})
    const comNicho = props.filter((k) => DO_NICHO.test(k))
    ok(`"${d.name}": nenhum parâmetro cita o nicho`, comNicho.length === 0, comNicho.join(', ') || props.join(', ') || '(sem parâmetros)')
}

console.log('\nO schema de parâmetros é o que a API de tool-calling espera')
for (const d of defs) {
    const p = d.parameters as { type?: string; properties?: Record<string, unknown> } | undefined
    ok(`"${d.name}" declara um objeto de parâmetros`, p?.type === 'object' && typeof p.properties === 'object')
}

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
