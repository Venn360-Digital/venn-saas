/**
 * Renderiza um e-mail de campanha de exemplo, para olhar o resultado.
 *
 *   npx tsx scripts/previa-campanha.ts            # grava em /tmp
 *   npx tsx scripts/previa-campanha.ts saida.html
 *
 * Existe porque a casca de e-mail é tabela aninhada com estilo em atributo (ver
 * `src/lib/email/blocos.ts`) e **não** se confere por leitura: o que diz se o
 * botão saiu botão e se o espaçamento fecha é abrir no navegador. O projeto já
 * tinha o precedente em `docs/emails-preview.html`, para o transacional.
 *
 * Também exercita o que é lógica pura e tem como errar calado: a troca de
 * `{{nome}}`, o padrão de queda quando o contato não tem nome, o marcador
 * desconhecido que fica à vista, e a versão em texto puro — que é derivada dos
 * blocos, não de um strip do HTML, justamente para o botão não perder o link.
 */
import { writeFileSync } from 'node:fs'
import {
    campanhaEmTexto,
    lerBlocos,
    primeiroNome,
    renderCampanha,
    type Bloco,
} from '../src/lib/email/blocos'

const blocos: Bloco[] = [
    { tipo: 'titulo', texto: 'Oi {{nome}}, faz um tempinho!' },
    {
        tipo: 'texto',
        texto:
            'Passou mais de seis meses desde a sua última visita. A limpeza semestral é o que evita o tratamento caro depois — e leva meia hora.\n\nSe preferir, responda este e-mail e a gente marca por aqui.',
    },
    { tipo: 'botao', texto: 'Escolher um horário', url: 'https://exemplo.com.br/agendar' },
    { tipo: 'divisor' },
    {
        tipo: 'texto',
        texto: 'Atendemos de segunda a sexta, das 8h às 18h, e sábado até meio-dia.',
    },
]

/** O que a tela vai salvar no banco — passa por `lerBlocos` como no envio real. */
const comoVemDoBanco = lerBlocos(JSON.parse(JSON.stringify(blocos)))

const casca = {
    blocos: comoVemDoBanco,
    campos: {
        nome: primeiroNome('Maria Aparecida da Silva'),
        nomeCompleto: 'Maria Aparecida da Silva',
        unidade: 'Clínica Sorriso Claro',
    },
    assinatura: 'Clínica Sorriso Claro · Rua das Acácias, 120 · São Paulo, SP',
    descadastroUrl: 'https://odontobox.venn360.com/descadastro/ws.ct.assinatura',
    preheader: 'Sua limpeza semestral está em atraso',
}

const destino = process.argv[2] ?? '/tmp/previa-campanha.html'
writeFileSync(destino, renderCampanha(casca), 'utf8')

console.log(`HTML: ${destino}`)
console.log(`      ${renderCampanha(casca).length} bytes`)
console.log('')
console.log('── Blocos lidos ──')
console.log(`${comoVemDoBanco.length} de ${blocos.length} aceitos por lerBlocos`)
console.log('')
console.log('── Texto puro ──')
console.log(campanhaEmTexto(casca))
console.log('')
console.log('── Campos de mesclagem ──')

/**
 * Os casos que se erra calado.
 *
 * O terceiro é o que a primeira rodada desta prévia acusou: com padrão de queda
 * `'tudo bem'`, "Oi {{nome}}, tudo bem?" virava "Oi tudo bem, tudo bem?". O
 * padrão não sabe a frase em volta, então a queda é vazia e a vírgula órfã é
 * engolida junto.
 */
const CASOS: [string, string, { nome?: string | null }][] = [
    ['com nome', 'Oi {{nome}}, tudo bem?', { nome: 'Maria' }],
    ['sem nome', 'Oi {{nome}}, tudo bem?', { nome: null }],
    ['sem nome, com queda', 'Oi {{nome|amiga}}, tudo bem?', { nome: null }],
    ['sem nome, fim de frase', 'Olá {{nome}}!', { nome: null }],
    ['marcador desconhecido', 'Oi {{sobrenome}}!', { nome: 'Maria' }],
]

for (const [rotulo, texto, campos] of CASOS) {
    const saida = campanhaEmTexto({ ...casca, blocos: [{ tipo: 'texto', texto }], campos }).split(
        '\n'
    )[0]
    console.log(`  ${rotulo.padEnd(24)} → ${saida}`)
}

console.log('')
console.log('── Escapes ──')

/**
 * O que importa não é se a string `onerror=` aparece — escapada, ela é texto
 * inerte dentro do `alt`, e procurá-la dá falso positivo (deu, na primeira
 * rodada). O que importa é se alguma **aspa crua** sobrou dentro de um valor de
 * atributo, porque é ela que fecha o atributo e abre um novo.
 */
const hostil: Bloco[] = [
    { tipo: 'titulo', texto: '<script>alert(1)</script>' },
    { tipo: 'botao', texto: 'Clique', url: 'javascript:alert(1)' },
    { tipo: 'imagem', url: 'data:text/html,<script>alert(1)</script>', alt: 'x" onerror="y' },
]
const html = renderCampanha({ ...casca, blocos: hostil })

/** Acha atributo cujo valor contém uma aspa crua — ou seja, escapou do valor. */
const fugaDeAtributo = /<[^>]*\s[a-zA-Z-]+="[^"]*"[^\s>=/][^>]*>/.test(
    html.replace(/&quot;/g, '\u0001')
)

const checagens: [string, boolean][] = [
    ['tag <script> no corpo', html.includes('<script>')],
    ['href javascript:', html.includes('javascript:')],
    ['src data:text/html', html.includes('data:text/html')],
    ['aspa crua escapou do atributo', fugaDeAtributo],
]
for (const [rotulo, falhou] of checagens) {
    console.log(`  ${rotulo.padEnd(32)} ${falhou ? 'SIM — DEFEITO' : 'não'}`)
}

if (checagens.some(([, falhou]) => falhou)) process.exitCode = 1
