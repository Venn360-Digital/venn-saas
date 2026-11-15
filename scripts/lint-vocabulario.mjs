#!/usr/bin/env node
/**
 * Palavra de nicho presa dentro de `packages/**` — contra um teto que só desce.
 *
 * ## Por que teto, e não zero
 *
 * A varredura mediu 610 ocorrências em `packages/`, fora de comentário. Exigir
 * zero de uma vez reprovaria todo build até o último arquivo ser reescrito, o
 * que empurra para desligar a verificação. Então o teto é o número de hoje e
 * **só pode descer** — o mesmo desenho do `lint-colors`, pelo mesmo motivo:
 * quando chega a zero o teto é zero e a regra passa a ser absoluta.
 *
 * Sem este teto o trabalho se desfaz: um texto novo escrito com a palavra do
 * primeiro nicho entra sem resistência, e a conta volta a subir enquanto
 * alguém a baixa do outro lado.
 *
 * ## O que conta, e o que não conta
 *
 * Conta o que está em `packages/**`, FORA de comentário — comentário
 * explicando por que o nicho existe não é texto que o usuário lê, e proibi-lo
 * ensinaria a escrever código sem explicação.
 *
 * Não conta `apps/**`: ali a palavra do nicho é legítima e esperada — é o lugar
 * onde a identidade mora. Nem o `brand.ts`, que é justamente onde a palavra
 * deve estar escrita.
 *
 * Os comentários saem por **análise de estado**, não por regex: uma expressão
 * regular não distingue `//` dentro de uma string de um comentário de verdade,
 * e errar nessa direção inflaria a conta com texto que não é texto.
 *
 *     node scripts/lint-vocabulario.mjs              confere contra o teto
 *     node scripts/lint-vocabulario.mjs --list       mostra onde
 *     node scripts/lint-vocabulario.mjs --baixar     grava o teto novo (menor)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { arquivosDeCodigo, exigirPiso, conferirAllowlist } from './lib/raizes-de-codigo.mjs'

const ROOT = process.cwd()
const TETO_FILE = join(ROOT, 'scripts', 'vocabulario-baseline.json')
const LISTAR = process.argv.includes('--list')
const BAIXAR = process.argv.includes('--baixar')

/**
 * Os termos de nicho do primeiro app, por eixo do vocabulário.
 *
 * É uma lista de palavras, e isso é uma escolha consciente — a lição desta fase
 * diz para desconfiar de critério textual. Aqui o texto É o objeto da
 * verificação: a regra não é "quais arquivos olhar" (isso é derivado de
 * `arquivosDeCodigo()`), é "qual palavra não deve estar presa". Para essas, a
 * lista é o critério certo, e ela cresce quando um eixo novo entra no contrato.
 */
const TERMOS = {
    'pessoa atendida': /\bpacientes?\b/gi,
    'organização': /\bcl[íi]nicas?\b|\bconsult[óo]rios?\b/gi,
    'quem presta': /\bespecialistas?\b|\bdentistas?\b/gi,
    'o que se vende': /\bprocedimentos?\b/gi,
}

/**
 * O texto sem comentários, por análise de estado.
 *
 * Não cobre string com `//` dentro (uma URL, por exemplo) — ela entra como
 * comentário e a contagem fica a MENOS, nunca a mais. Errar para menos aqui é
 * o lado seguro: o teto desce com o trabalho real e não com um artefato da
 * medição.
 */
function semComentarios(src) {
    const out = []
    let i = 0
    let estado = 'codigo'
    while (i < src.length) {
        const c = src[i]
        const d = src.slice(i, i + 2)
        if (estado === 'codigo') {
            if (d === '/*') { estado = 'bloco'; i += 2; continue }
            if (d === '//') { estado = 'linha'; i += 2; continue }
            out.push(c); i++; continue
        }
        if (estado === 'bloco') {
            if (d === '*/') { estado = 'codigo'; i += 2 } else i++
            continue
        }
        if (estado === 'linha') {
            if (c === '\n') { estado = 'codigo'; out.push(c) }
            i++
        }
    }
    return out.join('')
}

/**
 * Onde a palavra do nicho é CONTRATO, e por isso fica.
 *
 * `lib/nav.ts` mapeia SLUGS de URL para rótulo, e as chaves `pacientes`,
 * `especialistas` e `procedimentos` são **endereços que alguém guardou** — o
 * rewrite ainda os resolve, e a trilha não deve mostrar slug cru. Trocá-las
 * apagaria o redirecionamento: foi o que um renomeio em massa quase fez em
 * 15/11/2026, e `test:redirects` existe por causa disso.
 *
 * A isenção é por ARQUIVO e conferida por `conferirAllowlist`: se o caminho
 * sair de lugar, a lista acusa a órfã em vez de passar calada.
 */
const DE_CONTRATO = ['packages/core/src/lib/nav.ts']

const doCore = arquivosDeCodigo().filter((f) => f.startsWith('packages/'))
exigirPiso('lint-vocabulario', doCore, 400)
conferirAllowlist('lint-vocabulario', DE_CONTRATO, doCore)

let total = 0
const porArquivo = []
for (const f of doCore) {
    if (DE_CONTRATO.includes(f)) continue
    let n = 0
    const limpo = semComentarios(readFileSync(join(ROOT, f), 'utf8'))
    const achados = []
    for (const [eixo, re] of Object.entries(TERMOS)) {
        const m = limpo.match(re) ?? []
        if (!m.length) continue
        n += m.length
        achados.push(`${m.length} ${eixo}`)
    }
    if (!n) continue
    total += n
    porArquivo.push({ f, n, achados })
}
porArquivo.sort((a, b) => b.n - a.n)

console.log(`lint-vocabulario: ${doCore.length} arquivo(s) de packages/ varrido(s)`)

if (LISTAR) {
    for (const { f, n, achados } of porArquivo) {
        console.log(`  ${String(n).padStart(4)}  ${f}  (${achados.join(', ')})`)
    }
    console.log('')
}

if (BAIXAR) {
    const antes = existsSync(TETO_FILE) ? JSON.parse(readFileSync(TETO_FILE, 'utf8')).total : Infinity
    if (total > antes) {
        console.error(`✖ o teto só desce: ${antes} → ${total} seria uma alta.`)
        process.exit(1)
    }
    writeFileSync(TETO_FILE, JSON.stringify({ total, arquivos: porArquivo.length }, null, 2) + '\n')
    console.log(`teto gravado: ${total} (era ${antes === Infinity ? 'nenhum' : antes}) em ${porArquivo.length} arquivo(s)`)
    process.exit(0)
}

const teto = existsSync(TETO_FILE) ? JSON.parse(readFileSync(TETO_FILE, 'utf8')).total : Infinity
if (total > teto) {
    console.error(`\n✖ palavra de nicho presa em packages/ AUMENTOU: ${total} agora, teto de ${teto}.`)
    console.error('')
    console.error('Texto novo no core nasce pelo vocabulário, não pela palavra do 1º nicho:')
    console.error("  const v = useVocab()                      // cliente")
    console.error("  const v = vocab(workspace.settings)       // servidor")
    console.error("  `abrir ${comArtigo(v, 'pessoa')}`         // onde há determinante")
    console.error('')
    console.error('Onde ver: node scripts/lint-vocabulario.mjs --list')
    process.exit(1)
}
if (total < teto) {
    console.log(`${total} ocorrência(s) em ${porArquivo.length} arquivo(s) — ABAIXO do teto de ${teto}.`)
    console.log('Baixe o teto no mesmo commit: node scripts/lint-vocabulario.mjs --baixar')
    process.exit(1)
}
console.log(`${total} ocorrência(s) em ${porArquivo.length} arquivo(s) — no teto.`)
