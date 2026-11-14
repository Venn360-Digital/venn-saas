/**
 * O script do widget é JavaScript válido?
 *
 *   npm run check:widget
 *
 * Ele vive dentro de um template literal em resolverNoCodigo('rotas/widget.js/route.ts'), e o
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
/*
 * O sufixo precisa dizer `rotas/`, e isto quase passou errado na Fase 3.
 *
 * Era `app/widget.js/route.ts`. Quando o conteúdo foi para
 * `packages/core/src/rotas/widget.js/route.ts`, esse sufixo passou a casar
 * APENAS a casca gerada em `apps/<app>/src/app/widget.js/route.ts` — um
 * resultado, sem ambiguidade, resolvido com sucesso. `resolverNoCodigo` fez o
 * trabalho dele; o sufixo é que ficou apontando para o lugar errado.
 *
 * Só falhou porque este verificador procura o template DENTRO do arquivo. Um
 * critério mais frouxo teria aprovado a casca vazia — a mesma assimetria da
 * guarda do tempo real: a verificação que grita custa um ciclo de build, a que
 * se cala custa um incidente.
 */
import { resolverNoCodigo } from './lib/raizes-de-codigo.mjs'

const ARQUIVO = resolverNoCodigo('rotas/widget.js/route.ts')
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
