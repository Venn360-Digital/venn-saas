/**
 * As quatro formas de cada eixo do vocabulário são coerentes entre si?
 *
 * Esta verificação existe por um defeito que esteve em produção, e a forma dele
 * explica por que nenhuma das redes anteriores o pegaria:
 *
 *     profissional: 'profissional',    ← neutro
 *     Profissional: 'Especialista',    ← do nicho
 *     servico:      'servico',         ← neutro E SEM CEDILHA
 *     Servico:      'Procedimento',    ← do nicho
 *
 * As formas MINÚSCULAS dos dois últimos eixos ficaram com a palavra neutra, e
 * `servico`/`servicos` ainda por cima sem acento — resíduo do `replace` global
 * que trocou `procedimento` por `servico` ao neutralizar as URLs, e que entrou
 * nos VALORES em vez de só nos caminhos. Resultado na tela:
 * "Nenhum servico cadastrado ainda", "Procurou por qual servico".
 *
 * Por que passou por tudo:
 *   - o typecheck só vê `string` nos dois lados;
 *   - o `lint-vocabulario` tem teto ZERO para palavra de nicho, mas varre
 *     `packages/**`, e o `brand.ts` do app é exatamente onde a palavra do nicho
 *     DEVE estar;
 *   - o `test-vocabulario` e o `test-ferramentas` rodam com a marca de teste
 *     fictícia, que é coerente por construção;
 *   - e nenhuma asserção comparava as formas entre si.
 *
 * A invariante é checável e vale para qualquer nicho: `Xxx` é `xxx` com a
 * primeira letra maiúscula, e o plural começa pelo singular. Ela não diz qual
 * palavra usar — diz que as quatro formas falam da MESMA palavra.
 *
 *     pnpm run check:vocabulario-marca
 */
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const EIXOS = ['organizacao', 'pessoa', 'profissional', 'servico'] as const
type Eixo = (typeof EIXOS)[number]

/** O plural de cada eixo, como o contrato o escreve. */
const PLURAL: Record<Eixo, string> = {
    organizacao: 'organizacoes',
    pessoa: 'pessoas',
    profissional: 'profissionais',
    servico: 'servicos',
}

let falhas = 0
function ok(nome: string, condicao: boolean, detalhe = '') {
    console.log(`  ${condicao ? 'PASS' : 'FAIL'}  ${nome}${detalhe ? `  — ${detalhe}` : ''}`)
    if (!condicao) falhas++
}

/** Maiúscula na primeira letra, sem tocar no resto (acento incluído). */
function capitalizar(s: string): string {
    return s.length === 0 ? s : s[0].toLocaleUpperCase('pt-BR') + s.slice(1)
}

/**
 * Os apps são DERIVADOS da pasta, nunca listados: um app novo entra nesta
 * verificação por existir, não por alguém se lembrar de acrescentá-lo.
 */
const apps = existsSync('apps')
    ? readdirSync('apps').filter((n) => existsSync(join('apps', n, 'src', 'config', 'brand.ts')))
    : []

if (apps.length === 0) {
    console.error('✖ nenhum app com src/config/brand.ts em apps/ — não há marca para conferir.')
    process.exit(2)
}

for (const app of apps) {
    const caminho = join(process.cwd(), 'apps', app, 'src', 'config', 'brand.ts')
    const mod = await import(pathToFileURL(caminho).href)
    const v = mod.BRAND?.vocabulario
    console.log(`\n── ${app}`)
    ok(`${app}: declara vocabulário`, Boolean(v))
    if (!v) continue

    ok(
        `${app}: declara o gênero dos quatro eixos`,
        EIXOS.every((e) => v.genero?.[e] === 'm' || v.genero?.[e] === 'f'),
        EIXOS.map((e) => `${e}=${v.genero?.[e] ?? '?'}`).join(' ')
    )

    for (const eixo of EIXOS) {
        const sing = v[eixo]
        const Sing = v[capitalizar(eixo)]
        const plur = v[PLURAL[eixo]]
        const Plur = v[capitalizar(PLURAL[eixo])]

        ok(`${app}/${eixo}: as quatro formas existem e não são vazias`,
            [sing, Sing, plur, Plur].every((x) => typeof x === 'string' && x.trim().length > 0),
            `${sing} / ${Sing} / ${plur} / ${Plur}`)

        /*
         * O coração desta verificação. Comparar a maiúscula com a minúscula
         * capitalizada pega o caso real: 'Especialista' contra
         * capitalizar('profissional') = 'Profissional'.
         */
        ok(`${app}/${eixo}: a forma maiúscula é a minúscula capitalizada`,
            Sing === capitalizar(sing),
            `${Sing} vs ${capitalizar(sing)}`)
        ok(`${app}/${eixo}: o plural maiúsculo é o plural capitalizado`,
            Plur === capitalizar(plur),
            `${Plur} vs ${capitalizar(plur)}`)

        /*
         * O plural compartilha o radical do singular — e o radical é o singular
         * MENOS a última letra, não o singular inteiro.
         *
         * A primeira escrita desta linha era `plur.startsWith(sing)` e reprovou
         * um dado correto: em português, palavra terminada em -l faz plural em
         * -is, então `profissional` → `profissionais` não começa por
         * `profissional`. Mesma família: -el → -eis, -ol → -ois. Cortar a
         * última letra cobre essas e continua pegando o que importa — um plural
         * que fala de outra palavra (`servico` → `procedimentos`) não casa o
         * radical.
         *
         * Não vale apertar mais: `agência` → `agências`, `clínica` → `clínicas`
         * e `serviço` → `serviços` têm acento e cedilha no radical, e qualquer
         * normalização que os apague deixaria passar a troca de palavra.
         */
        const radical = typeof sing === 'string' ? sing.slice(0, -1) : ''
        ok(`${app}/${eixo}: o plural compartilha o radical do singular`,
            typeof plur === 'string' && radical.length > 0 && plur.startsWith(radical),
            `${plur} começa por "${radical}"?`)
        ok(`${app}/${eixo}: singular e plural são diferentes`, sing !== plur, `${sing} / ${plur}`)
    }
}

console.log('')
if (falhas > 0) {
    console.log(`FALHOU: ${falhas} incoerência(s) no vocabulário da marca.`)
    console.log('Não lança exceção nenhuma: a palavra errada — ou sem acento — vai para a tela,')
    console.log('para o assunto do e-mail e para dentro do prompt do agente.')
    process.exit(1)
}
console.log(`OK: ${apps.length} marca(s) com as quatro formas coerentes nos quatro eixos.`)
