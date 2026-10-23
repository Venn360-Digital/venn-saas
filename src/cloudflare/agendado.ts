/// <reference types="@cloudflare/workers-types" />

import { cronDaVarredura, rotinasDoDisparo } from '@/lib/cron/agenda'
import type { CronJobName } from '@/lib/queue/definitions'
import { varrerOutbox } from './publicador'

/**
 * O handler dos Cron Triggers.
 *
 * ## Despacha pelo padrão, nunca pelo relógio
 *
 * `event.cron` traz o padrão que disparou, e é por ele que se descobre o que
 * fazer. Olhar a hora do relógio parece equivalente e não é: o disparo pode
 * chegar com segundos de atraso e cair no minuto seguinte — e então a rotina do
 * minuto não roda e a do minuto seguinte roda duas vezes. É um defeito que
 * aparece raramente e nunca da mesma forma, que é o pior tipo para diagnosticar.
 *
 * ## Enfileira, não executa
 *
 * O cron põe a rotina na fila `cron` e devolve. Não roda a rotina aqui, por dois
 * motivos: o teto de CPU de um Cron Trigger com intervalo menor que uma hora é
 * de 30 segundos — e a conciliação de cobrança lê a API do Asaas conta por conta
 * —; e uma rotina que falha num Cron Trigger não tem retentativa, enquanto numa
 * fila tem, com DLQ.
 *
 * A exceção é a varredura da outbox, que roda aqui mesmo: ela é o que faz as
 * filas funcionarem, e enfileirá-la na fila que ela própria alimenta seria uma
 * dependência circular que trava em silêncio quando o consumidor cai.
 */

interface EnvAgendado {
    CRON: Queue<{ task: CronJobName }>
    SALA_DO_WORKSPACE: DurableObjectNamespace
}

/**
 * O padrão que carrega a varredura — **derivado da agenda, nunca escrito aqui**.
 *
 * Era um literal `'* * * * *'`. Quando o horário mudou na agenda (para o Neon
 * poder suspender de madrugada), o literal deixou de casar e a varredura teria
 * parado por completo, em silêncio: `event.cron` nunca mais seria igual.
 * Derivar faz a divergência deixar de ser possível.
 */
const CRON_DA_VARREDURA = cronDaVarredura()

export async function aoSerAgendado(
    event: ScheduledController,
    env: EnvAgendado,
    ctx: ExecutionContext
): Promise<void> {
    const rotinas = rotinasDoDisparo(event.cron)

    /**
     * A varredura da outbox pega carona no disparo de cada minuto.
     *
     * Um Cron Trigger próprio seria um trigger a mais e uma invocação a mais por
     * minuto para o mesmo efeito. E ela vai primeiro: os eventos pendentes são o
     * que a tela de alguém está esperando, enquanto as rotinas são manutenção.
     */
    /**
     * A varredura começa agora e é **aguardada no fim**, depois de as rotinas
     * estarem na fila — assim ela não atrasa o enfileiramento, que era o
     * motivo do `ctx.waitUntil` que havia aqui.
     *
     * Por que não mais `waitUntil` solto: o handler retornava com a varredura
     * ainda rodando, `entrada.ts` fechava o cliente do Prisma no `finally`, e
     * a varredura — no mesmo escopo — recebia um cliente **novo** que ninguém
     * fechava. Medido em 2026-10-23, já com o fecho nas rotas e nas filas: o
     * `scheduled` seguia pendurado 11,8 s por disparo, a cada minuto, sem log
     * e sem exceção. Aguardar aqui é o que põe a varredura dentro do ciclo de
     * vida do cliente. `ctx` fica na assinatura para quem precisar dele.
     */
    void ctx
    const varredura =
        event.cron === CRON_DA_VARREDURA
            ? varrerOutbox(env).catch((erro) => {
                  console.error('[CRON] varredura da outbox falhou:', erro)
              })
            : Promise.resolve()

    if (rotinas.length === 0) {
        /**
         * Disparo sem rotina correspondente **é** um problema.
         *
         * Significa que o `wrangler.jsonc` tem um trigger que a agenda não
         * conhece — alguém editou o arquivo à mão, ou removeu uma rotina sem
         * republicar. `check:filas` compara os dois justamente para isto não
         * chegar aqui, e esta linha é a segunda rede.
         */
        console.error(`[CRON] disparo "${event.cron}" não corresponde a nenhuma rotina`)
        await varredura
        return
    }

    /**
     * Uma mensagem por rotina, e não uma lista numa mensagem.
     *
     * Duas rotinas podem cair no mesmo minuto, e separadas elas ganham
     * retentativa independente: se a poda de retenção falhar, o boletim diário
     * não é repetido junto com ela.
     */
    await Promise.all(rotinas.map((task) => env.CRON.send({ task })))
    await varredura
}
