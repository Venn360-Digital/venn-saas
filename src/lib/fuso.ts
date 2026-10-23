/**
 * O fuso do negócio, explícito — porque o do processo deixou de existir.
 *
 * **O que quebrou.** Na VPS o contêiner rodava com `TZ=America/Sao_Paulo`, e
 * `new Date(y, m, d)` ou `data.getDate()` davam o dia de Brasília. O Cloudflare
 * Workers **ignora `TZ`**: o isolate é sempre UTC. A variável continua
 * declarada em `cloudflare.config.ts`, e não adianta nada — medido em
 * 2026-10-22, uma atividade que vencia às 10:00 de Brasília do próprio dia
 * aparecia como **atrasada**, porque às 22:17 de Brasília o servidor já achava
 * que era o dia seguinte.
 *
 * **Por que o fuso do negócio e não o de quem olha.** A clínica é brasileira e
 * opera num dia só. Deixar o navegador decidir faria o filtro "Hoje" significar
 * coisas diferentes no cliente e no servidor — e é o servidor que consulta o
 * banco. Fixar o fuso aqui faz os dois concordarem, que é a condição para o
 * recorte da tela bater com o número que volta.
 *
 * **Por que `Intl` e não `-3` na mão.** O Brasil não tem horário de verão desde
 * 2019, então hoje o deslocamento é constante — mas ele já mudou antes e pode
 * mudar de novo por decreto. `Intl` lê a base de fusos do runtime; a conta à mão
 * ficaria certa até o dia em que ficasse errada, em silêncio.
 */

export const FUSO_DO_NEGOCIO = 'America/Sao_Paulo'

interface Partes {
    ano: number
    mes: number
    dia: number
    hora: number
    minuto: number
    segundo: number
}

const FORMATO = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO_DO_NEGOCIO,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
})

/** As partes do calendário brasileiro para um instante. */
export function partesNoFuso(instante: Date): Partes {
    const p: Record<string, string> = {}
    for (const parte of FORMATO.formatToParts(instante)) p[parte.type] = parte.value

    return {
        ano: Number(p.year),
        mes: Number(p.month),
        dia: Number(p.day),
        // `hour12: false` pode devolver 24 para a meia-noite em alguns runtimes.
        hora: Number(p.hour) % 24,
        minuto: Number(p.minute),
        segundo: Number(p.second),
    }
}

/** `yyyy-MM-dd` no fuso do negócio. `toISOString()` empurraria o dia. */
export function diaNoFuso(instante: Date = new Date()): string {
    const { ano, mes, dia } = partesNoFuso(instante)
    return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Quanto o fuso do negócio está à frente do UTC naquele instante, em ms.
 * Negativo no Brasil (−3 h hoje).
 */
function deslocamentoMs(instante: Date): number {
    const { ano, mes, dia, hora, minuto, segundo } = partesNoFuso(instante)
    const comoSeFosseUtc = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo)
    // O instante tem milissegundos que as partes não carregam; descontá-los
    // mantém a conta exata em vez de arredondada para o segundo.
    return comoSeFosseUtc - (instante.getTime() - instante.getMilliseconds())
}

/**
 * O instante UTC da meia-noite daquele dia **no fuso do negócio**.
 *
 * Duas passadas: a primeira estima o deslocamento com um palpite, a segunda o
 * recalcula já perto do alvo. É o que cobre a virada de horário de verão, em que
 * o deslocamento do dia não é o do palpite.
 */
export function inicioDoDia(diaIso: string): Date {
    const [ano, mes, dia] = diaIso.split('-').map(Number)
    const meiaNoiteComoUtc = Date.UTC(ano, mes - 1, dia)

    let instante = new Date(meiaNoiteComoUtc)
    for (let passada = 0; passada < 2; passada++) {
        instante = new Date(meiaNoiteComoUtc - deslocamentoMs(instante))
    }

    return instante
}

/** O instante UTC do fim daquele dia — a meia-noite do dia seguinte. */
export function fimDoDia(diaIso: string): Date {
    return inicioDoDia(somarDias(diaIso, 1))
}

/**
 * Soma dias a um `yyyy-MM-dd`, no calendário — sem instante, sem fuso.
 *
 * Ancorado ao meio-dia UTC de propósito: somar em cima da meia-noite faria a
 * data escorregar um dia em qualquer deslocamento negativo.
 */
export function somarDias(diaIso: string, dias: number): string {
    const [ano, mes, dia] = diaIso.split('-').map(Number)
    const ancora = new Date(Date.UTC(ano, mes - 1, dia, 12))
    ancora.setUTCDate(ancora.getUTCDate() + dias)

    return [
        ancora.getUTCFullYear(),
        String(ancora.getUTCMonth() + 1).padStart(2, '0'),
        String(ancora.getUTCDate()).padStart(2, '0'),
    ].join('-')
}

/** O dia da semana (0 = domingo) de um `yyyy-MM-dd`, no calendário. */
export function diaDaSemana(diaIso: string): number {
    const [ano, mes, dia] = diaIso.split('-').map(Number)
    return new Date(Date.UTC(ano, mes - 1, dia, 12)).getUTCDay()
}

/** O primeiro e o último dia do mês de um `yyyy-MM-dd`, no calendário. */
export function limitesDoMes(diaIso: string): { primeiro: string; ultimo: string } {
    const [ano, mes] = diaIso.split('-').map(Number)
    const primeiro = `${ano}-${String(mes).padStart(2, '0')}-01`
    // Dia zero do mês seguinte é o último do atual.
    const fim = new Date(Date.UTC(ano, mes, 0, 12))

    return {
        primeiro,
        ultimo: [
            fim.getUTCFullYear(),
            String(fim.getUTCMonth() + 1).padStart(2, '0'),
            String(fim.getUTCDate()).padStart(2, '0'),
        ].join('-'),
    }
}
