/**
 * O script do widget é JavaScript válido?
 *
 *   npm run check:widget
 *
 * Ele vive dentro de um template literal em `src/app/widget.js/route.ts`, e o
 * TypeScript não olha o conteúdo de uma string. Um `if (x { ... }` ali dentro
 * passa pelo `tsc`, passa pelo build, e só quebra no navegador de um cliente —
 * **verificado**: com esse erro injetado, o `tsc` não reclama e esta checagem
 * recusa.
 *
 * O que ela **não** precisa cobrir é um backtick ou `${...}` dentro do script,
 * que encerram o template e quebram o próprio arquivo TypeScript: desses o
 * `tsc` já cuida, e cuidou — foi assim que um backtick num comentário foi
 * pego antes de chegar aqui.
 */
import { readFileSync } from 'node:fs'

const ARQUIVO = 'src/app/widget.js/route.ts'
const linhas = readFileSync(ARQUIVO, 'utf8').split('\n')

const inicio = linhas.findIndex((l) => l.includes('=> `'))
const fim = linhas.findIndex((l) => l === '})()`')

if (inicio === -1 || fim === -1 || fim < inicio) {
    console.error(`Não encontrei o template do widget em ${ARQUIVO}.`)
    console.error('Se a forma do arquivo mudou, ajuste este script — não o apague.')
    process.exit(1)
}

let corpo = linhas.slice(inicio, fim + 1).join('\n')
corpo = corpo.slice(corpo.indexOf('`') + 1, corpo.lastIndexOf('`'))
// A única interpolação é a origem; vira uma string qualquer para a checagem.
corpo = corpo.replace('${JSON.stringify(origem)}', '"https://exemplo"')

try {
    new Function(corpo)
    console.log(`Widget OK — ${corpo.length} caracteres de JavaScript válido.`)
} catch (erro) {
    console.error('ERRO de sintaxe no script do widget:', erro.message)
    process.exit(1)
}
