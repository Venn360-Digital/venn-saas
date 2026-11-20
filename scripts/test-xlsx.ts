/**
 * O leitor de `.xlsx` sem biblioteca — provado em Node, contra um arquivo
 * montado aqui mesmo.
 *
 *   npm run test:xlsx
 *
 * O arquivo é construído byte a byte (zip com `deflateRawSync`, XML escrito à
 * mão), porque o projeto não tem gerador de planilha — e é melhor assim: o
 * teste prova o leitor contra a forma que o Excel, o LibreOffice e o Google
 * Sheets gravam, não contra o que outra biblioteca nossa gravaria.
 *
 * O que protege: strings compartilhadas e inline, número, booleano, fórmula
 * com valor em cache, linha vazia descartada, aba nomeada, entrada armazenada
 * (método 0) e comprimida (método 8), e o que acontece com um zip que não é
 * planilha.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import { deflateRawSync } from 'node:zlib'

import { extrairTextoDeXlsx, XlsxIlegivel } from '@venn/core/lib/documentos/xlsx'

let passou = 0
let falhou = 0

function conferir(nome: string, real: unknown, esperado: unknown) {
    const a = JSON.stringify(real)
    const b = JSON.stringify(esperado)
    if (a === b) {
        passou++
        console.log(`  ok  ${nome}`)
    } else {
        falhou++
        console.log(`  XX  ${nome}\n        esperado: ${b}\n        veio:     ${a}`)
    }
}

/** CRC-32, que o zip exige no cabeçalho (o leitor não confere, mas um zip honesto o tem). */
function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff
    for (const b of bytes) {
        c ^= b
        for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    return (c ^ 0xffffffff) >>> 0
}

function u16(n: number): number[] {
    return [n & 0xff, (n >> 8) & 0xff]
}
function u32(n: number): number[] {
    return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
}

/** Um zip com as entradas dadas; `armazenar` grava sem comprimir (método 0). */
function zip(entradas: { nome: string; texto: string; armazenar?: boolean }[]): Uint8Array {
    const partes: number[] = []
    const central: number[] = []
    for (const e of entradas) {
        const nome = Array.from(new TextEncoder().encode(e.nome))
        const cru = new TextEncoder().encode(e.texto)
        const dados = e.armazenar ? cru : new Uint8Array(deflateRawSync(cru))
        const metodo = e.armazenar ? 0 : 8
        const crc = crc32(cru)
        const offset = partes.length
        partes.push(
            ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(metodo), ...u16(0), ...u16(0),
            ...u32(crc), ...u32(dados.length), ...u32(cru.length), ...u16(nome.length), ...u16(0),
            ...nome, ...Array.from(dados)
        )
        central.push(
            ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(metodo), ...u16(0), ...u16(0),
            ...u32(crc), ...u32(dados.length), ...u32(cru.length), ...u16(nome.length), ...u16(0), ...u16(0),
            ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nome
        )
    }
    const inicioCentral = partes.length
    partes.push(...central)
    partes.push(
        ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entradas.length), ...u16(entradas.length),
        ...u32(central.length), ...u32(inicioCentral), ...u16(0)
    )
    return Uint8Array.from(partes)
}

const SHARED = `<?xml version="1.0"?><sst count="3" uniqueCount="3">
<si><t>Serviço</t></si><si><t>Preço</t></si><si><r><t>Clare</t></r><r><t>amento &amp; cia</t></r></si></sst>`

const WORKBOOK = `<?xml version="1.0"?><workbook><sheets><sheet name="Tabela 2026" sheetId="1" r:id="rId1"/><sheet name="Obs" sheetId="2" r:id="rId2"/></sheets></workbook>`

const SHEET1 = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>450</v></c><c r="C2" t="b"><v>1</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>Implante</t></is></c><c r="B3"><f>B2*4</f><v>1800</v></c></row>
<row r="4"><c r="A4"/><c r="B4"/></row>
</sheetData></worksheet>`

const SHEET2 = `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Valores à vista</t></is></c></row></sheetData></worksheet>`

async function main() {
    const arquivo = zip([
        { nome: '[Content_Types].xml', texto: '<Types/>', armazenar: true },
        { nome: 'xl/workbook.xml', texto: WORKBOOK },
        { nome: 'xl/sharedStrings.xml', texto: SHARED },
        { nome: 'xl/worksheets/sheet1.xml', texto: SHEET1 },
        { nome: 'xl/worksheets/sheet2.xml', texto: SHEET2, armazenar: true },
    ])

    const texto = await extrairTextoDeXlsx(arquivo)
    console.log('\n— o texto extraído —\n')
    console.log(texto.split('\n').map((l) => '    ' + l).join('\n'))
    console.log('')

    conferir('a aba leva o nome do workbook', texto.startsWith('## Tabela 2026\n'), true)
    conferir('cabeçalho por string compartilhada, separado por tabulação', texto.includes('Serviço\tPreço'), true)
    conferir('string rica (vários <r>) e entidade XML', texto.includes('Clareamento & cia\t450\tVERDADEIRO'), true)
    conferir('string inline e fórmula pelo valor em cache', texto.includes('Implante\t1800'), true)
    conferir('linha vazia não vira linha em branco', texto.split('\n').filter((l) => l === '').length, 1)
    conferir('segunda aba, entrada armazenada sem compressão', texto.endsWith('## Obs\nValores à vista'), true)

    const semPlanilha = zip([{ nome: 'oi.txt', texto: 'nada', armazenar: true }])
    conferir('zip sem planilha devolve vazio, não lança', await extrairTextoDeXlsx(semPlanilha), '')

    let lancou: unknown = null
    try {
        await extrairTextoDeXlsx(new TextEncoder().encode('isto não é um zip'))
    } catch (e) {
        lancou = e
    }
    conferir('o que não é zip lança XlsxIlegivel', lancou instanceof XlsxIlegivel, true)

    console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
    process.exit(falhou > 0 ? 1 : 0)
}

void main()
