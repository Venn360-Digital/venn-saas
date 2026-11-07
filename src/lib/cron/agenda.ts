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
 * As rotinas. **Dezessete** entradas para dezesseis tarefas — a verificação de
 * integração aparece duas vezes, com um intervalo de dia e outro de noite —
 * que o `cronsParaWrangler()` reduz a **catorze** gatilhos, porque padrões
 * repetidos caem no mesmo e um gatilho duplicado seria invocação dobrada.
 *
 * (Os números são medidos, não contados à mão: `check:filas` afirma a
 * contagem, e foi ele que acusou quando esta frase ficou velha.)
 *
 * O escalonamento é de propósito e foi preservado item por item: rodar tudo em
 * `:00` concentrava o banco no mesmo instante. Os motivos de cada horário estão
 * no `scheduler.ts` e não foram repetidos aqui — duplicar justificativa é
 * garantir que uma das cópias fique velha.
 *
 * **As janelas de hora não são arrumação.** Elas existem para o compute do Neon
 * poder suspender, e a conta está na primeira rotina abaixo. Alargar qualquer
 * uma delas custa CU-hora da mesma franquia que o atendimento usa.
 */
/**
 * De qual rotina a varredura da outbox pega carona: a de menor intervalo, que é
 * o que a varredura quer.
 *
 * Ela precisa ter **uma única** entrada na tabela — ver `cronDaVarredura()`.
 */
export const TAREFA_DA_VARREDURA: CronJobName = 'activity-reminders'

export const ROTINAS: Rotina[] = [
    /**
     * **O disparo que carrega a varredura da outbox** — e o único que muda de
     * intervalo, não só de janela. Ele era de cada minuto, 24 h por dia.
     *
     * 1. **A janela.** Fora do horário da clínica ele batia no Postgres sem
     *    ninguém para ler o resultado, e o *scale to zero* do Neon — que
     *    suspende após 5 min de ociosidade e **não pode ser desligado no plano
     *    Free** — nunca chegava a agir.
     * 2. **O intervalo**, depois de fazer a conta: a janela sozinha não cabia.
     *    Quatorze horas de compute acordado sem parar, ao mínimo de 0,25 CU,
     *    dão ~106 CU-hora/mês contra uma franquia de 100 — o cron gastava a
     *    cota inteira e **não sobrava nada para o tráfego real**, que é quem
     *    deveria gastá-la. A dez minutos o compute fica acordado ~55% da
     *    janela: ~60 CU-hora/mês, e a folga é o que o atendimento consome.
     *
     * Medido em 2026-10-23: `active_time_seconds` / `compute_time_seconds` do
     * projeto dá exatamente 0,25 — é esse o tamanho do compute, e é por isso
     * que a franquia de 100 CU-hora equivale a 400 horas acordado por mês,
     * 13,1 por dia.
     *
     * **Por que dez minutos é aceitável aqui, e não seria em outro lugar.** As
     * duas coisas que pegam carona neste disparo toleram atraso por desenho:
     *
     * - o lembrete de atividade **complementa** a consulta que a Topbar já faz
     *   do navegador (está escrito em `activity-reminders.ts`) — ele não é a
     *   entrega, é o empurrão;
     * - a varredura da outbox é a **rede** do tempo real, não o caminho
     *   principal: `publicarAgora` segue imediato, e o que a varredura pega é
     *   o evento que já falhou nele.
     *
     * Cinco minutos não serviria: é o próprio tempo de ociosidade do Neon, e o
     * compute não suspenderia nunca — a mesma conta de antes, com um décimo do
     * trabalho feito.
     *
     * **O que se perde das 21 h às 7 h:** lembrete não dispara e a varredura
     * não roda. O caminho imediato continua funcionando.
     */
    { task: 'activity-reminders', brt: '*/10 7-20 * * *' },

    /** Materializa ocorrências com dias de horizonte: catorze passadas por dia
     * convergem igual a vinte e quatro. */
    { task: 'activity-recurrence', brt: '7 7-20 * * *' },

    { task: 'credits-reset', brt: '13 3 * * *' },

    /** As janelas de aviso têm 24 h de largura (36–60 h e 12–36 h do fim), e o
     * corte é derivado em `getBillingState` na hora, não aqui. Nenhuma conta
     * deixa de ser avisada por não haver passada de madrugada — e um aviso de
     * cobrança às 3 h da manhã seria pior que nenhum. */
    { task: 'trial-lifecycle', brt: '17 7-20 * * *' },

    { task: 'retention', brt: '41 4 * * *' },

    /**
     * A verificação de integração é a que **cura** a linha caída, então ela é
     * a única que continua rodando de madrugada — e por isso tem duas entradas.
     *
     * De dia, de dez em dez minutos: esse é o teto do tempo que uma linha fica
     * fora sem ninguém perceber, e é o número que `integration-health.ts`
     * documenta depois das três horas fora do ar de 2026-10-15.
     *
     * De noite, de hora em hora — no mesmo minuto do boletim, de propósito. As
     * duas rotinas caem no mesmo padrão, viram **um** gatilho e acordam o
     * compute **uma vez** por hora em vez de duas. O teto noturno sobe de dez
     * minutos para uma hora, o que é o certo: a cura é automática (um
     * `connect` pelo JID guardado), e de madrugada não há atendente para
     * ganhar nada com os outros cinquenta minutos.
     */
    { task: 'integration-health', brt: '*/10 7-20 * * *' },
    { task: 'integration-health', brt: '2 * * * *' },

    /** Prazo em dias; de hora em hora já era fino demais. */
    { task: 'conversation-autoclose', brt: '21 7-20 * * *' },

    { task: 'follow-up', brt: '0 7 * * *' },

    /**
     * **Fica de hora em hora, 24 h — e isso é de propósito.**
     *
     * O boletim é entregue na hora que cada clínica escolheu, e o seletor em
     * Conta → Automações oferece as **24**. Restringir este cron à janela da
     * clínica tiraria o boletim de quem configurou 6 h ou 22 h, em silêncio e
     * sem erro em lugar nenhum — o pior resultado possível. Se um dia o
     * seletor passar a oferecer menos horas, este padrão acompanha.
     *
     * O custo é uma passada por hora da madrugada, e ela é **compartilhada**
     * com a verificação de integração acima: um gatilho, um despertar.
     */
    { task: 'daily-briefing', brt: '2 * * * *' },

    /**
     * A janela é a do **código**, não a da clínica: `auto-follow-up.ts` tem
     * `BUSINESS_START = 9` e `BUSINESS_END = 18` e sai antes de qualquer
     * consulta fora disso. Com hora curinga, quinze das vinte e quatro
     * invocações eram garantidamente inúteis.
     *
     * Os dois números andam juntos. Mudar um sem o outro não quebra nada —
     * só volta a gastar invocação à toa, ou deixa de enviar numa hora
     * autorizada. O teste em `check-filas.ts` prende o par.
     */
    { task: 'auto-follow-up', brt: '35 9-17 * * *' },

    /** Renova a partir de 15 dias do vencimento: perder dez passadas por dia
     * não tira nem 1% da folga. */
    { task: 'instagram-token-refresh', brt: '48 7-20 * * *' },

    /**
     * A mineração de lacunas: **segunda-feira de manhã, e é a primeira rotina
     * semanal do sistema**.
     *
     * Semanal porque agrupar exige ter o conjunto na mão: a terceira formulação
     * de uma pergunta só revela que as duas primeiras eram a mesma coisa.
     * Segunda cedo porque ela lê a semana que acabou, e porque a fila de
     * aprovação chega junto com quem senta para trabalhar.
     *
     * **6 h e não 21 h**, e não é estética: `paraUTC` recusa hora que cruza a
     * meia-noite **quando o padrão restringe dia**, porque avançar o dia da
     * semana num campo de cron tem casos de borda que não valem para um uso. 6 h
     * BRT viram 9 h UTC no mesmo dia; 21 h virariam 0 h de terça, e a rotina
     * rodaria no dia errado. O erro apareceria em `check:filas`, não em
     * produção — mas aparecer no teste também custa tempo.
     */
    { task: 'minerar-lacunas', brt: '26 6 * * 1' },

    { task: 'billing-dunning', brt: '27 5 * * *' },
    { task: 'billing-reconcile', brt: '47 5 * * *' },

    /**
     * A sonda de credencial de IA. Uma vez por dia, 06h09 BRT.
     *
     * Não encosta no Postgres — só chama a OpenAI e, no pior caso, manda um
     * e-mail —, então não gasta CU-hora do Neon nem precisa caber numa das
     * janelas acima. O horário é só para não colidir com as outras.
     *
     * Uma vez por dia e não de hora em hora: credencial quebrada não se cura
     * sozinha, então a segunda medição do dia não acrescenta informação — e
     * um e-mail por hora sobre o mesmo defeito é como se ensina alguém a
     * criar filtro para o remetente.
     */
    { task: 'ia-credencial', brt: '9 6 * * *' },

    /**
     * Dispara as campanhas agendadas cuja hora chegou (ver
     * `broadcast-dispatch.ts`). De dez em dez minutos, na janela da clínica:
     *
     * - **O intervalo** é o teto do atraso entre a hora agendada e o disparo —
     *   dez minutos é fino o bastante para marketing e não derruba o orçamento
     *   de CU-hora do Neon (cron de ≤5 min nunca deixa o compute suspender).
     * - **A janela** 7–20 (BRT) cobre o horário comercial; campanha agendada para
     *   fora dela sai na primeira passada da manhã, que é o certo para disparo de
     *   marketing. É a mesma janela dos demais crons — e o conversor para UTC só
     *   aceita intervalo que não cruza a meia-noite (7–20 → 10–23 UTC; 7–21
     *   viraria 10–24 e seria recusado).
     */
    { task: 'broadcast-dispatch', brt: '*/10 7-20 * * *' },
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

    /**
     * Intervalo de horas — convertido SÓ quando o deslocamento não cruza a
     * meia-noite.
     *
     * A versão anterior recusava todo intervalo, e a recusa estava certa pelo
     * motivo certo: "1-5" deslocado vira "4-8", que é um intervalo diferente e
     * ainda válido — meio-converter produz um horário plausível e errado.
     *
     * Mas há um caso em que a conversão é demonstrável: quando `fim + 3 <= 23`,
     * o intervalo inteiro cabe no mesmo dia UTC e o conjunto de horas é o mesmo.
     * `7-20` BRT vira `10-23` UTC, hora a hora. Já `20-7` viraria `23-10`, que
     * não é intervalo válido e precisaria de dois — e aí a recusa continua,
     * porque um campo de cron não expressa isso sem ambiguidade.
     */
    const faixa = hora.match(/^(\d{1,2})-(\d{1,2})$/)
    if (faixa) {
        const de = Number(faixa[1])
        const ate = Number(faixa[2])

        if (de < 0 || ate > 23) {
            throw new PadraoNaoConversivelError(padraoBrt, `intervalo ${de}-${ate} fora de 0–23`)
        }
        if (de > ate) {
            throw new PadraoNaoConversivelError(
                padraoBrt,
                `intervalo ${de}-${ate} está invertido; um intervalo que dá a volta no dia precisa de dois`
            )
        }

        const deUtc = de - DESLOCAMENTO_SP
        const ateUtc = ate - DESLOCAMENTO_SP

        if (ateUtc > 23) {
            throw new PadraoNaoConversivelError(
                padraoBrt,
                `o intervalo ${de}-${ate} cruza a meia-noite em UTC (viraria ${deUtc}-${ateUtc}); ` +
                    'precisaria de dois intervalos e isso não está implementado'
            )
        }
        if (diaDoMes !== '*' || diaDaSemana !== '*') {
            throw new PadraoNaoConversivelError(
                padraoBrt,
                'intervalo de horas com restrição de dia não está implementado'
            )
        }

        return [minuto, `${deUtc}-${ateUtc}`, diaDoMes, mes, diaDaSemana].join(' ')
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
/**
 * Em homologação, **só o que dispara uma vez por dia**.
 *
 * ## O que foi medido, e por que isto existe
 *
 * Em 2026-11-07 a franquia do Neon estourou e a Odontobox saiu do ar. Ao
 * levantar a causa apareceu um consumidor que ninguém havia contado: os
 * Workers de homologação registram **a mesma agenda de produção**, e cada
 * disparo mantém o banco acordado pelos 5 min de ociosidade do Neon.
 *
 * A medição, no projeto de um app irmão, nos 7 dias do período:
 *
 *   - branch `staging`:    64 h de compute acordado
 *   - branch `production`: 58 h
 *
 * **Homologação consumia mais que produção, num app sem um único usuário.**
 * Somando os dois computes dos três projetos: ~450 CU-hora/mês, com zero
 * tráfego.
 *
 * ## A regra, e por que é regra e não lista
 *
 * Cai em homologação tudo que dispara **mais de uma vez por dia**: minuto ou
 * hora que não seja um número único. Fica o resto, no horário exato.
 *
 * É regra e não lista de nomes porque lista envelhece: a tarefa que alguém
 * acrescentar amanhã com `*​/5` entraria em homologação sem ninguém notar, e o
 * custo voltaria calado. A regra julga a cadência, que é o que custa.
 *
 * Efeito medido na tabela de hoje: de 14 gatilhos para **7**, e de ~164 disparos
 * por dia para **7** — de ~10 h para ~35 min de compute acordado por dia.
 *
 * ## O que homologação perde
 *
 * As nove tarefas de alta frequência não rodam lá: lembrete de atividade, saúde
 * das integrações, despacho de transmissão, a varredura da outbox e as quatro
 * de hora em hora. O que isso custa em capacidade de ensaio é pouco e vale
 * dizer qual é:
 *
 *   - a varredura da outbox é a **rede** do tempo real, não o caminho — o
 *     `publicarAgora` continua imediato em homologação;
 *   - as outras oito ainda disparam em produção, e `check:filas` /
 *     `check:trabalhos` continuam provando a tabela inteira nos dois ambientes.
 *
 * O que se perde de verdade é exercitar aquelas nove **em execução** antes da
 * produção. Foi uma troca consciente: elas custavam metade da franquia para
 * ensaiar código que o CI já tipa e cujas provas já afirmam a estrutura.
 */
function disparaMaisDeUmaVezPorDia(utc: string): boolean {
    const [minuto, hora] = utc.split(' ')
    /**
     * A hora tem de ser **um número só**. Qualquer outra coisa — `*`, `10-23`,
     * `*​/2`, `8,14` — dispara mais de uma vez por dia.
     *
     * A primeira versão desta função só olhava `*` e `/`, e deixou passar
     * `17 10-23` — que dispara **catorze** vezes por dia. Quatro das tarefas
     * estão nessa forma, e elas sozinhas respondem por mais da metade dos
     * disparos; a regra que as deixava passar não resolvia nada.
     */
    const horaUnica = /^\d{1,2}$/.test(hora)
    const minutoUnico = /^\d{1,2}$/.test(minuto)
    return !minutoUnico || !horaUnica
}

export function cronsParaWrangler(ambiente: 'production' | 'stg' = 'production'): string[] {
    const todos = [...new Set(rotinasEmUTC().map((r) => r.utc))]
    const alvo = ambiente === 'stg' ? todos.filter((u) => !disparaMaisDeUmaVezPorDia(u)) : todos
    return alvo.sort()
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
/**
 * O padrão, **em UTC**, do disparo que carrega a varredura da outbox.
 *
 * Existe porque `agendado.ts` comparava `event.cron` com um literal
 * `'* * * * *'` escrito à mão. Mudar o horário aqui e esquecer lá faria a
 * comparação ser sempre falsa e a varredura **parar por completo, em silêncio**
 * — não só fora do horário. Derivar da agenda torna a divergência impossível.
 */
export function cronDaVarredura(): string {
    /**
     * `filter` e não `find`, e a contagem é verificada.
     *
     * Desde 2026-10-23 a tabela tem rotina com **duas** entradas (a verificação
     * de integração, com um intervalo de dia e outro de noite). Um `find` sobre
     * uma tarefa nessa situação devolveria a primeira e pareceria funcionar: a
     * varredura passaria a rodar só numa das duas janelas, sem erro em lugar
     * nenhum. Então a condição deixou de ser "existe" e passou a ser "existe uma
     * só" — se alguém der um segundo horário à tarefa da varredura, falha aqui,
     * no `check:filas`, e não em produção.
     */
    const rotinas = ROTINAS.filter((r) => r.task === TAREFA_DA_VARREDURA)

    if (rotinas.length === 0) {
        throw new Error(`a rotina "${TAREFA_DA_VARREDURA}" sumiu da agenda; a varredura da outbox ficaria órfã`)
    }
    if (rotinas.length > 1) {
        throw new Error(
            `a rotina "${TAREFA_DA_VARREDURA}" tem ${rotinas.length} horários ` +
                `(${rotinas.map((r) => r.brt).join(', ')}); a varredura pega carona em um só e ` +
                'rodaria pela metade — escolha outra tarefa para carregá-la ou deixe esta com um horário'
        )
    }

    return paraUTC(rotinas[0].brt)
}

export function rotinasDoDisparo(cronUtc: string): CronJobName[] {
    const alvo = cronUtc.trim().split(/\s+/).join(' ')
    return rotinasEmUTC()
        .filter((r) => r.utc === alvo)
        .map((r) => r.task)
}
