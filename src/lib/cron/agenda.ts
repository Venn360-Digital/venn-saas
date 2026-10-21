import type { CronJobName } from '@/lib/queue/definitions'

/**
 * As rotinas periódicas, e a conversão para o fuso em que a Cloudflare as roda.
 *
 * **O risco que este arquivo existe para eliminar.** O BullMQ aceitava um `tz`
 * junto do padrão, e o `scheduler.ts` passava `America/Sao_Paulo`: os horários
 * escritos ali são horário de Brasília e sempre foram. **Cloudflare Cron
 * Triggers rodam em UTC e não aceitam fuso.** Copiar os padrões como estão faria
 * o boletim das 7 h disparar às 4 h da manhã, a poda de retenção às 1 h41, e o
 * corte de cobrança às 2 h27 — tudo funcionando, tudo na hora errada, e nada
 * acusando erro.
 *
 * É o tipo de defeito que só aparece quando alguém reclama que recebeu o
 * boletim de madrugada.
 *
 * Então a intenção fica declarada em **BRT**, que é como o produto pensa, e o
 * UTC é **calculado**. Escrever UTC à mão funcionaria hoje e divergiria na
 * primeira vez que alguém ajustasse um horário olhando só a tabela.
 */

export interface Rotina {
    task: CronJobName
    /** O horário pretendido, em `America/Sao_Paulo`. Cinco campos. */
    brt: string
}

/**
 * As treze rotinas, com os horários que o `workers/src/scheduler.ts` já usava.
 *
 * O escalonamento é de propósito e foi preservado item por item: rodar tudo em
 * `:00` concentrava o banco no mesmo instante. Os motivos de cada horário estão
 * no `scheduler.ts` e não foram repetidos aqui — duplicar justificativa é
 * garantir que uma das cópias fique velha.
 */
export const ROTINAS: Rotina[] = [
    { task: 'activity-reminders', brt: '* * * * *' },
    { task: 'activity-recurrence', brt: '7 * * * *' },
    { task: 'credits-reset', brt: '13 3 * * *' },
    { task: 'trial-lifecycle', brt: '17 * * * *' },
    { task: 'retention', brt: '41 4 * * *' },
    { task: 'integration-health', brt: '*/10 * * * *' },
    { task: 'conversation-autoclose', brt: '21 * * * *' },
    { task: 'follow-up', brt: '0 7 * * *' },
    { task: 'daily-briefing', brt: '2 * * * *' },
    { task: 'auto-follow-up', brt: '35 * * * *' },
    { task: 'instagram-token-refresh', brt: '48 * * * *' },
    { task: 'billing-dunning', brt: '27 5 * * *' },
    { task: 'billing-reconcile', brt: '47 5 * * *' },
]

/**
 * O deslocamento de São Paulo em relação a UTC, em horas.
 *
 * **−3 fixo, e isso é uma afirmação sobre o Brasil, não sobre fusos em geral.**
 * O horário de verão foi extinto em 2019 (Decreto 9.772/2019) e São Paulo é
 * UTC−3 o ano inteiro. Se ele voltar, as cinco rotinas de hora fixa saem de
 * hora por uma hora, e o conserto é este número — mas um `Intl` resolvendo o
 * fuso em tempo de execução não ajudaria: os Cron Triggers são **estáticos**, a
 * tabela é gerada em tempo de build e publicada no `wrangler.jsonc`.
 *
 * Em outras palavras: o fuso não pode ser dinâmico aqui nem se quiséssemos. O
 * que pode é o teste acusar quando o pressuposto mudar.
 */
export const DESLOCAMENTO_SP = -3

export class PadraoNaoConversivelError extends Error {
    constructor(padrao: string, motivo: string) {
        super(`não sei converter "${padrao}" para UTC: ${motivo}`)
        this.name = 'PadraoNaoConversivelError'
    }
}

/**
 * Converte um padrão de cinco campos de BRT para UTC.
 *
 * Só desloca o campo da hora, e **recusa** o que não sabe converter — ver a
 * nota sobre dia da semana abaixo. Recusar é o ponto: uma conversão que chuta o
 * caso difícil produz um horário plausível e errado, que é o pior resultado
 * possível para um cron.
 */
export function paraUTC(padraoBrt: string): string {
    const campos = padraoBrt.trim().split(/\s+/)

    if (campos.length !== 5) {
        throw new PadraoNaoConversivelError(padraoBrt, `esperados 5 campos, vieram ${campos.length}`)
    }

    const [minuto, hora, diaDoMes, mes, diaDaSemana] = campos

    // Hora curinga: nada a fazer.
    //
    // "toda hora" (asterisco) e "a cada N horas" (asterisco-barra-N) significam
    // o mesmo em qualquer fuso, porque o conjunto de horas é fechado sob
    // rotação. Já um intervalo como "1-5" **não** é: deslocado viraria "4-8",
    // que é um intervalo diferente mas ainda válido — e por isso perigoso.
    // Nenhuma rotina usa intervalo de horas, então ele é recusado abaixo em vez
    // de meio-convertido.
    //
    // (Comentário de linha e não de bloco de propósito: a sequência
    // asterisco-barra do padrão de cron fecharia um comentário de bloco no meio.
    // Foi exatamente o que aconteceu na primeira versão deste arquivo.)
    if (hora === '*' || /^\*\/\d+$/.test(hora)) {
        return [minuto, hora, diaDoMes, mes, diaDaSemana].join(' ')
    }

    if (!/^\d+$/.test(hora)) {
        throw new PadraoNaoConversivelError(
            padraoBrt,
            `campo de hora "${hora}" não é número nem curinga; converta à mão e documente`
        )
    }

    const horaBrt = Number(hora)
    if (horaBrt < 0 || horaBrt > 23) {
        throw new PadraoNaoConversivelError(padraoBrt, `hora ${horaBrt} fora de 0–23`)
    }

    // BRT = UTC−3, então UTC = BRT + 3.
    const horaUtc = (horaBrt - DESLOCAMENTO_SP + 24) % 24
    const virouODia = horaBrt - DESLOCAMENTO_SP >= 24

    /**
     * Virou o dia e há restrição de calendário: recusa.
     *
     * Uma rotina às 22 h de Brasília é 1 h UTC **do dia seguinte**. Se ela
     * também disser "só na segunda-feira" ou "só no dia 1º", o dia precisa
     * avançar junto — e avançar dia da semana ou dia do mês num padrão de cron
     * tem casos de borda (fim de mês, `L`, `W`) que não vale implementar para
     * zero usos.
     *
     * Nenhuma rotina atual tem restrição de calendário. Quando a primeira tiver,
     * este erro aparece no teste, não em produção.
     */
    if (virouODia && (diaDoMes !== '*' || diaDaSemana !== '*')) {
        throw new PadraoNaoConversivelError(
            padraoBrt,
            'a conversão cruza a meia-noite e o padrão restringe dia; ' +
                'avançar o dia não está implementado'
        )
    }

    return [minuto, String(horaUtc), diaDoMes, mes, diaDaSemana].join(' ')
}

/** As rotinas com o padrão já em UTC, para gerar a configuração do Wrangler. */
export function rotinasEmUTC(): Array<{ task: CronJobName; brt: string; utc: string }> {
    return ROTINAS.map((r) => ({ ...r, utc: paraUTC(r.brt) }))
}

/**
 * Os padrões únicos em UTC, que é o que o `wrangler.jsonc` recebe.
 *
 * Únicos porque duas rotinas podem cair no mesmo minuto — e um Cron Trigger
 * repetido na configuração seria duas invocações para o mesmo instante, cada uma
 * despachando as duas rotinas: quatro execuções em vez de duas.
 */
export function cronsParaWrangler(): string[] {
    return [...new Set(rotinasEmUTC().map((r) => r.utc))].sort()
}

/**
 * Quais rotinas um disparo deve executar.
 *
 * O handler `scheduled` recebe o padrão que disparou em `event.cron`, e é por
 * ele que se descobre o que fazer — **não** pela hora do relógio. Olhar o
 * relógio parece equivalente e não é: o disparo pode chegar com segundos de
 * atraso e cair no minuto seguinte, e então a rotina do minuto não roda e a do
 * minuto seguinte roda duas vezes.
 */
export function rotinasDoDisparo(cronUtc: string): CronJobName[] {
    const alvo = cronUtc.trim().split(/\s+/).join(' ')
    return rotinasEmUTC()
        .filter((r) => r.utc === alvo)
        .map((r) => r.task)
}
