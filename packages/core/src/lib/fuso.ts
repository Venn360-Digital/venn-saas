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
 * **Por que o fuso do NEGÓCIO e não o de quem olha.** A unidade opera num dia
 * só. Deixar o navegador decidir faria o filtro "Hoje" significar coisas
 * diferentes no cliente e no servidor — e é o servidor que consulta o banco.
 * Um fuso por unidade faz os dois concordarem, que é a condição para o recorte
 * da tela bater com o número que volta.
 *
 * Isso continua valendo com fuso por unidade, e é a razão de **não** haver fuso
 * por pessoa aqui: duas pessoas da mesma unidade têm de concordar sobre que dia
 * é hoje, senão o mesmo compromisso cai em dias diferentes no relatório de cada
 * uma. Decisão do Andre em 2026-11-04.
 *
 * **O fuso agora é argumento, não constante.** Toda função que depende dele
 * aceita um, e cai em `FUSO_DO_NEGOCIO` quando omitido — foi assim que os 45
 * pontos de chamada existentes atravessaram esta mudança sem serem tocados.
 * `FUSO_DO_NEGOCIO` deixou de ser "o fuso do sistema" e passou a ser **o padrão
 * de quem não escolheu**: a unidade que nunca abriu a tela de Conta da Empresa
 * se comporta exatamente como antes.
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

/**
 * Um formatador por fuso, em cache.
 *
 * Era um `Intl.DateTimeFormat` só, preso a `FUSO_DO_NEGOCIO` no nível do
 * módulo — e era ele, sozinho, que tornava o fuso uma constante de instalação.
 * Trocá-lo por uma fábrica é o que permite a unidade ter fuso próprio sem
 * reescrever as dez funções que o usam.
 *
 * O cache não é otimização prematura: construir um `DateTimeFormat` é caro o
 * bastante para aparecer num laço de cron que percorre todas as unidades, e o
 * número de fusos distintos numa instalação é pequeno e estável.
 */
const FORMATOS = new Map<string, Intl.DateTimeFormat>()

function formatoDe(fuso: string): Intl.DateTimeFormat {
    let f = FORMATOS.get(fuso)
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone: fuso,
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        })
        FORMATOS.set(fuso, f)
    }
    return f
}

/** As partes do calendário brasileiro para um instante. */
export function partesNoFuso(instante: Date, fuso: string = FUSO_DO_NEGOCIO): Partes {
    const p: Record<string, string> = {}
    for (const parte of formatoDe(fuso).formatToParts(instante)) p[parte.type] = parte.value

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
export function diaNoFuso(instante: Date = new Date(), fuso: string = FUSO_DO_NEGOCIO): string {
    const { ano, mes, dia } = partesNoFuso(instante, fuso)
    return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Quanto o fuso do negócio está à frente do UTC naquele instante, em ms.
 * Negativo no Brasil (−3 h hoje).
 */
function deslocamentoMs(instante: Date, fuso: string): number {
    const { ano, mes, dia, hora, minuto, segundo } = partesNoFuso(instante, fuso)
    const comoSeFosseUtc = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo)
    // O instante tem milissegundos que as partes não carregam; descontá-los
    // mantém a conta exata em vez de arredondada para o segundo.
    return comoSeFosseUtc - (instante.getTime() - instante.getMilliseconds())
}

/**
 * O instante UTC de uma **hora de parede brasileira**.
 *
 * `instanteNoFuso('2026-10-22', '14:30')` é 14h30 na clínica — 17:30 UTC hoje.
 * É o que `data.setHours(14, 30)` fazia na VPS e deixou de fazer no Worker:
 * lá o mesmo código marca 14h30 **UTC**, três horas antes do combinado. Era o
 * caso dos lembretes de compromisso, que disparavam adiantados.
 *
 * Duas passadas: a primeira estima o deslocamento com um palpite, a segunda o
 * recalcula já perto do alvo. É o que cobre a virada de horário de verão, em que
 * o deslocamento do dia não é o do palpite.
 */
export function instanteNoFuso(
    diaIso: string,
    horaMinuto = '00:00',
    fuso: string = FUSO_DO_NEGOCIO
): Date {
    const [ano, mes, dia] = diaIso.split('-').map(Number)
    const [hora = 0, minuto = 0] = horaMinuto.split(':').map(Number)
    const alvoComoUtc = Date.UTC(ano, mes - 1, dia, hora, minuto)

    let instante = new Date(alvoComoUtc)
    for (let passada = 0; passada < 2; passada++) {
        instante = new Date(alvoComoUtc - deslocamentoMs(instante, fuso))
    }

    return instante
}

/** O instante UTC da meia-noite daquele dia **no fuso do negócio**. */
export function inicioDoDia(diaIso: string, fuso: string = FUSO_DO_NEGOCIO): Date {
    return instanteNoFuso(diaIso, '00:00', fuso)
}

/**
 * O início do dia brasileiro que **contém** este instante.
 *
 * Substitui `data.setHours(0, 0, 0, 0)`, que no Worker recua para a meia-noite
 * UTC — ou seja, para as 21h do dia anterior em Brasília.
 */
export function inicioDoDiaDe(instante: Date = new Date(), fuso: string = FUSO_DO_NEGOCIO): Date {
    return inicioDoDia(diaNoFuso(instante, fuso), fuso)
}

/** A hora (0–23) no fuso do negócio. Substitui `getHours()`. */
export function horaNoFuso(instante: Date = new Date(), fuso: string = FUSO_DO_NEGOCIO): number {
    return partesNoFuso(instante, fuso).hora
}

/** O ano no fuso do negócio. Substitui `getFullYear()`. */
export function anoNoFuso(instante: Date = new Date(), fuso: string = FUSO_DO_NEGOCIO): number {
    return partesNoFuso(instante, fuso).ano
}

/** `HH:mm` no fuso do negócio — a hora de parede que a clínica combinou. */
export function horaMinutoNoFuso(instante: Date, fuso: string = FUSO_DO_NEGOCIO): string {
    const { hora, minuto } = partesNoFuso(instante, fuso)
    return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`
}

/** O dia da semana (0 = domingo) no fuso do negócio. Substitui `getDay()`. */
export function diaDaSemanaNoFuso(instante: Date = new Date(), fuso: string = FUSO_DO_NEGOCIO): number {
    return diaDaSemana(diaNoFuso(instante, fuso))
}

/**
 * O dia de uma coluna **de data sem hora** — `dueDate` e afins.
 *
 * Essas colunas guardam o dia na meia-noite **UTC**: é o que
 * `new Date('2026-10-22')` produz, e é como a rota de atividades grava. Lê-las
 * no fuso do negócio devolveria o **dia anterior**, porque meia-noite UTC é 21h
 * em Brasília. Então o dia sai das partes UTC, e a hora de parede vem do campo
 * que a guarda (`startTime`) — ver `instanteNoFuso`.
 */
export function diaDeDataSemHora(instante: Date): string {
    return instante.toISOString().slice(0, 10)
}

/**
 * Meia-noite **UTC** do dia — a fronteira de colunas de data sem hora.
 *
 * **As duas fronteiras existem e não dá para escolher uma só.** Coluna de
 * instante (`createdAt`, `closedAt`, `lastMessageAt`) guarda o momento real, e o
 * dia dela começa à meia-noite **de Brasília** (`inicioDoDia`, 03:00Z). Coluna
 * de data sem hora (`dueDate`) guarda o dia na meia-noite **UTC**, e filtrá-la
 * por 03:00Z deixaria de fora justamente os compromissos daquele dia.
 *
 * O dia continua sendo decidido no fuso da clínica — `inicioDoDiaUtc(diaNoFuso(agora))`
 * é "hoje para a clínica, na fronteira em que `dueDate` foi gravada".
 */
export function inicioDoDiaUtc(diaIso: string): Date {
    return new Date(`${diaIso}T00:00:00.000Z`)
}

/** O instante UTC do fim daquele dia — a meia-noite do dia seguinte. */
export function fimDoDia(diaIso: string, fuso: string = FUSO_DO_NEGOCIO): Date {
    return inicioDoDia(somarDias(diaIso, 1), fuso)
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
