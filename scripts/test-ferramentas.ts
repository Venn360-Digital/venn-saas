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
import { vocab } from '@venn/core/lib/vocabulario'

let passou = 0
let falhou = 0

function ok(nome: string, condicao: boolean, detalhe = '') {
    console.log(`  ${condicao ? 'ok ' : 'FALHOU'} ${nome}${detalhe ? `  — ${detalhe}` : ''}`)
    if (condicao) passou++
    else falhou++
}

const defs = AGENT_TOOL_DEFINITIONS(vocab())

/*
 * O vocabulário vem por PARÂMETRO, e este bloco prova isso — na terceira
 * tentativa, porque as duas primeiras eram fracas e eu as vi falhar.
 *
 * ## Tentativa 1: só pegava regressão TOTAL
 *
 * Passava um vocabulário inventado e exigia que a palavra aparecesse. Com
 * `vocab()` reintroduzido em UMA descrição, seguiu verde: as outras 26 ainda
 * usavam o parâmetro. Rede que só vê a regressão inteira não é rede.
 *
 * ## Tentativa 2: comparava com as palavras PADRÃO, e a prosa atrapalhou
 *
 * Passava uma sentinela por eixo e exigia que nenhuma palavra padrão sobrasse.
 * Reprovou com `pessoa="pessoa"` — mas a descrição dizia "a **pessoa** da
 * equipe", prosa legítima que nada tem com o eixo do nicho. Teste textual não
 * distingue as duas, e afrouxar a asserção devolveria o furo da tentativa 1.
 *
 * E, de carona, a tentativa 2 revelou um defeito DELA: substituir `genero`
 * (que é `{pessoa:'m'|'f'}`, não texto) fazia `comArtigo` devolver `undefined`
 * no meio das descrições. O gênero é preservado aqui por isso.
 *
 * ## Tentativa 3: DUAS sentinelas, e a prosa deixa de importar
 *
 * Monta as definições duas vezes, com conjuntos artificiais diferentes, e
 * compara **contagem por eixo**. Nenhuma palavra real entra na conta, então
 * prosa não interfere. Uma única chamada que volte a `vocab()` para de
 * acompanhar a troca: a contagem daquele eixo cai de um lado e não do outro, e
 * a mensagem nomeia o eixo.
 */
const padrao = vocab()
const comGenero = (marca: string) =>
    ({
        ...Object.fromEntries(
            Object.entries(padrao)
                .filter(([k]) => k !== 'genero')
                .map(([k]) => [k, `${marca}${k}${marca}`])
        ),
        genero: padrao.genero,
    }) as unknown as typeof padrao

const A = comGenero('§')
const B = comGenero('¤')

function descricoes(no: unknown, saida: string[] = []): string[] {
    if (Array.isArray(no)) { for (const x of no) descricoes(x, saida); return saida }
    if (no && typeof no === 'object') {
        for (const [k, v] of Object.entries(no)) {
            if (k === 'description' && typeof v === 'string') saida.push(v)
            else descricoes(v, saida)
        }
    }
    return saida
}
const textoA = descricoes(AGENT_TOOL_DEFINITIONS(A)).join('\n')
const textoB = descricoes(AGENT_TOOL_DEFINITIONS(B)).join('\n')
const quantas = (texto: string, agulha: string) => texto.split(agulha).length - 1
const EIXOS = Object.keys(padrao).filter((k) => k !== 'genero')

console.log('\nO vocabulário do parâmetro chega a TODAS as descrições')

/*
 * ## Tentativa 4, e a 3 também era cega — vale registrar por quê
 *
 * A tentativa 3 comparava a contagem de sentinelas entre as duas montagens. Com
 * `vocab()` reintroduzido em UMA descrição, seguiu verde: aquela chamada
 * devolve a MESMA palavra nas duas montagens, então as duas contagens caem
 * juntas e a comparação não vê nada. Comparar dois lados que erram igual é não
 * comparar.
 *
 * O que vê é um número CONGELADO. `PISO_DE_SENTINELAS` é quantas vezes o
 * vocabulário do parâmetro aparece hoje nas descrições. Uma chamada que volte a
 * `vocab()` derruba o total e reprova; texto novo guiado pelo vocabulário faz o
 * total subir, e aí o piso sobe junto, no mesmo commit.
 *
 * Mesmo desenho do `lint-colors` e do `lint-vocabulario`, pela mesma razão: o
 * número é a memória do trabalho já feito, e sem ele o trabalho se desfaz um
 * `vocab()` por vez.
 */
const PISO_DE_SENTINELAS = 27
const totalSentinelas = EIXOS.reduce((soma, k) => soma + quantas(textoA, `§${k}§`), 0)
ok(
    'o vocabulário do parâmetro aparece ao menos o tanto de antes',
    totalSentinelas >= PISO_DE_SENTINELAS,
    totalSentinelas >= PISO_DE_SENTINELAS
        ? `${totalSentinelas} ocorrência(s), piso ${PISO_DE_SENTINELAS}`
        : `caiu para ${totalSentinelas}, piso é ${PISO_DE_SENTINELAS} — alguma descrição voltou a ler \`vocab()\` por dentro, ignorando a unidade`
)

const desacompanhados = EIXOS.filter(
    (k) => quantas(textoA, `§${k}§`) !== quantas(textoB, `¤${k}¤`)
)
ok(
    'as duas montagens são simétricas',
    desacompanhados.length === 0,
    desacompanhados.length
        ? `eixo(s) assimétrico(s): ${desacompanhados.join(', ')} — texto congelado entre montagens`
        : `${EIXOS.length} eixos`
)

ok(
    'nenhuma sentinela do 1º conjunto sobra no 2º',
    !EIXOS.some((k) => textoB.includes(`§${k}§`)),
    'sobrar significa texto congelado de uma montagem anterior — era o cache de módulo que saiu nesta mudança'
)

ok(
    'as descrições de fato usam o parâmetro',
    EIXOS.some((k) => quantas(textoA, `§${k}§`) > 0),
    'se nenhum eixo aparece, as definições ignoram o argumento'
)

ok(
    'os NOMES das ferramentas NÃO mudam',
    JSON.stringify(AGENT_TOOL_DEFINITIONS(A).map((d) => d.name)) ===
        JSON.stringify(defs.map((d) => d.name)),
    'nome é identificador que o modelo cita: fixo, só a descrição é do nicho'
)

ok(
    'nenhum `undefined` escapa para a descrição',
    !textoA.includes('undefined'),
    'o gênero não é texto: trocá-lo por sentinela fazia comArtigo devolver undefined'
)

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
