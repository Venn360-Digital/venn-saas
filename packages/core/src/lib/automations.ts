import type { Prisma } from '@venn/db'
import { POLITICA_PADRAO, lerPolitica, type PoliticaDeDistribuicao } from './conversas/distribuicao'

/**
 * O que a clínica deixou ligado.
 *
 * Guardado como JSON em `Workspace.automations` porque a lista cresce a cada
 * camada de automação — e uma coluna por chave viraria uma migração por
 * melhoria. Os padrões moram aqui, num lugar só: workspace sem configuração
 * nenhuma tem de se comportar igual a workspace configurado com o padrão.
 */
export interface Automations {
    /** Cria a tarefa de retomada nas fases que têm prazo. */
    followUpTasks: boolean
    /** O boletim da manhã, e a hora em que ele sai (0–23, fuso da clínica). */
    briefing: boolean
    briefingHour: number
    /** O boletim também no WhatsApp do responsável. */

    /**
     * Quem recebe a próxima conversa. Ver §11 do estudo e
     * `lib/conversas/distribuicao.ts`, que é quem decide.
     *
     * Mora aqui e não em coluna porque é ajuste, não dado: a conta muda de
     * estratégia numa tarde e não se quer uma migração por isso.
     */
    distribuicao: PoliticaDeDistribuicao

}

/**
 * O **primeiro degrau** da escada: minutos sem ação até o verde virar amarelo,
 * para quem não preencheu o campo Ausência na própria ficha. O segundo degrau é
 * fixo em 8 horas (ver `MINUTOS_PARA_DESCONECTADO`).
 *
 * Sem isto, todo mundo vai embora às 18h marcado como disponível e a
 * distribuição da madrugada cai em quem não está — exatamente o que o
 * interruptor de "só disponíveis" existe para evitar.
 *
 * **Constante, e não ajuste de conta.** Era `Automations.minutosParaAusente`,
 * configurável em Conta → Automações, e por isso o mesmo número existia em dois
 * lugares: lá e no campo Ausência de cada pessoa. O Andre mandou ficar **só o
 * da pessoa** em 2026-11-09. Medido no banco de produção antes de tirar: as
 * duas contas tinham exatamente 60 gravado — o padrão —, e nenhum usuário tinha
 * valor próprio, então a remoção não muda comportamento de ninguém.
 *
 * Uma hora: numa clínica a atendente passa esse tempo no balcão sem abrir o
 * computador, e aí ela está ocupada de verdade — lead que cai para quem não vai
 * olhar é pior que lead na fila geral. Quem precisa de outro número põe na
 * ficha dela, que é onde o atributo mora.
 */
export const MINUTOS_PARA_AUSENTE_PADRAO = 60

export const DEFAULT_AUTOMATIONS: Automations = {
    // Ligada por padrão porque não envia nada a paciente: só organiza a agenda
    // de quem atende, e nenhuma fase cobra enquanto não tiver prazo definido.
    followUpTasks: true,
    briefing: true,
    briefingHour: 8,
    // Nasce desligada: conta existente não ganha comportamento novo sozinha, e
    // distribuir sem ninguém ter marcado quem recebe seria pior que não
    // distribuir.
    distribuicao: POLITICA_PADRAO,
}

export function readAutomations(value: Prisma.JsonValue | null | undefined): Automations {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_AUTOMATIONS

    const raw = value as Record<string, unknown>
    const hour = Number(raw.briefingHour)

    return {
        followUpTasks: typeof raw.followUpTasks === 'boolean' ? raw.followUpTasks : DEFAULT_AUTOMATIONS.followUpTasks,
        briefing: typeof raw.briefing === 'boolean' ? raw.briefing : DEFAULT_AUTOMATIONS.briefing,
        briefingHour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_AUTOMATIONS.briefingHour,
        /**
         * A conferência mora em `lerPolitica`, no módulo puro, e não aqui.
         *
         * Era inline, e tinha de sair: a linha de atendimento também guarda uma
         * política (`AgentIntegration.distribuicao`), e duas cópias desta
         * validação divergiriam na primeira estratégia nova. Foi o que aconteceu
         * com `fixo` — a lista de estratégias válidas estava escrita aqui.
         */
        distribuicao: lerPolitica(raw.distribuicao),
    }
}
