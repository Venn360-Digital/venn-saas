/**
 * Confere uma pasta de `.md` de treinamento antes de ela ir para a tela.
 *
 *   npm run check:treinamento -- ./caminho/da/pasta
 *
 * Usa **as mesmas funções da tela e do indexador** — `secionarMarkdown`,
 * `semComentarios` e `conferirEstrutura`. Não é uma segunda implementação da
 * regra: é a mesma, chamada de outro lugar. Se divergisse, o verificador
 * aprovaria documento que a tela recusa, que é pior que não ter verificador.
 *
 * Existe porque a tela confere **um** documento por vez, depois de colado. Com
 * sete documentos por conta e várias contas, conferir antes economiza a
 * descoberta tardia — e o número de trechos que cada um vai gerar é a melhor
 * pista de que o Markdown está bem seccionado: documento longo que vira dois
 * trechos tem cabeçalho de menos.
 */
import { readFileSync, existsSync } from 'node:fs'
import { DOCUMENTOS, conferirEstrutura } from '@/lib/treinamento/documentos'
import { secionarMarkdown, semComentarios } from '@/lib/rag/secoes'

const pasta = process.argv[2]
if (!pasta) {
    console.error('uso: npm run check:treinamento -- ./pasta-com-os-md')
    process.exit(2)
}

let problemas = 0
let ausentes = 0
let somaDoPrompt = 0

console.log(`\nConferindo ${pasta}\n`)

for (const doc of DOCUMENTOS) {
    const caminho = `${pasta}/${doc.slug}.md`

    if (!existsSync(caminho)) {
        ausentes++
        console.log(`  --  ${doc.slug.padEnd(20)} arquivo ausente (${doc.slug}.md)`)
        continue
    }

    const texto = readFileSync(caminho, 'utf8')
    const secoes = secionarMarkdown(semComentarios(texto))
    const c = conferirEstrutura(doc, secoes)
    const excedeu = texto.length > doc.teto
    if (doc.modo === 'prompt') somaDoPrompt += texto.length

    const avisos: string[] = []
    if (excedeu) avisos.push(`ACIMA DO TETO em ${(texto.length - doc.teto).toLocaleString('pt-BR')}`)
    if (c.faltando.length) avisos.push(`sem conteúdo em: ${c.faltando.join(', ')}`)
    if (c.extras.length) avisos.push(`seção não prevista: ${c.extras.join(', ')}`)
    // Documento longo que vira poucos trechos quase sempre é falta de cabeçalho.
    if (doc.modo === 'rag' && texto.length > 1500 && secoes.length < 4) {
        avisos.push(`só ${secoes.length} trechos para ${texto.length} caracteres — faltam subtítulos?`)
    }

    const ok = avisos.length === 0
    if (!ok) problemas++

    console.log(
        `  ${ok ? 'ok' : 'XX'}  ${doc.slug.padEnd(20)} ` +
        `${String(texto.length).padStart(6)}/${String(doc.teto).padStart(6)}  ` +
        `${String(secoes.length).padStart(2)} trechos` +
        (avisos.length ? `\n      ${avisos.join('\n      ')}` : '')
    )
}

const TETO_PROMPT = DOCUMENTOS.filter((d) => d.modo === 'prompt').reduce((s, d) => s + d.teto, 0)
console.log(
    `\n  somado nos de prompt: ${somaDoPrompt.toLocaleString('pt-BR')} de ` +
    `${TETO_PROMPT.toLocaleString('pt-BR')} — vão em TODA mensagem`
)

if (ausentes > 0) console.log(`  ${ausentes} arquivo(s) ausente(s)`)
console.log(problemas > 0 ? `\n${problemas} documento(s) com aviso\n` : '\nTudo certo\n')
process.exit(problemas > 0 ? 1 : 0)
