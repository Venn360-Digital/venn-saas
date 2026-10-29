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
import { DOCUMENTOS, conferirEstrutura, orcamentoDoPrompt } from '@/lib/treinamento/documentos'
import { secionarMarkdown, semComentarios } from '@/lib/rag/secoes'

const pasta = process.argv[2]
if (!pasta) {
    console.error('uso: npm run check:treinamento -- ./pasta-com-os-md')
    process.exit(2)
}

let problemas = 0
let ausentes = 0
const conteudoDoPrompt: Record<string, string> = {}

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
    const c = conferirEstrutura(secoes)
    const excedeu = texto.length > doc.teto
    if (doc.modo === 'prompt') conteudoDoPrompt[doc.slug] = texto

    const avisos: string[] = []
    if (excedeu) avisos.push(`ACIMA DO TETO em ${(texto.length - doc.teto).toLocaleString('pt-BR')}`)
    if (c.semSecoes) avisos.push('sem subtítulos — será cortado por tamanho, não por assunto')
    if (c.grandesDemais.length) {
        avisos.push(`longo demais para um trecho: ${c.grandesDemais.join(', ')}`)
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

const o = orcamentoDoPrompt(conteudoDoPrompt)
const comoLer: Record<string, string> = {
    confortavel: 'confortável',
    pesado: 'pesado — considere mover fato consultável para os documentos de acervo',
    'muito-pesado': 'MUITO pesado — o modelo atende pior ao meio de um contexto deste tamanho',
}
console.log(
    `\n  comportamento (vai em TODA mensagem): ${o.usado.toLocaleString('pt-BR')} caracteres, ` +
    `~${o.tokens.toLocaleString('pt-BR')} tokens — ${comoLer[o.faixa]}`
)

if (ausentes > 0) console.log(`  ${ausentes} arquivo(s) ausente(s)`)
console.log(problemas > 0 ? `\n${problemas} documento(s) com aviso\n` : '\nTudo certo\n')
process.exit(problemas > 0 ? 1 : 0)
