import type { Prisma } from '#prisma'
import {
    POLITICA_PADRAO,
    type EstrategiaDeDistribuicao,
    type PoliticaDeDistribuicao,
} from '@/lib/conversas/distribuicao'

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

    /**
     * O **primeiro degrau** da escada: minutos sem ação até o verde virar
     * amarelo. O segundo é fixo em 8 horas (ver `MINUTOS_PARA_DESCONECTADO`).
     *
     * Sem isto, todo mundo vai embora às 18h marcado como disponível e a
     * distribuição da madrugada cai em quem não está — exatamente o que o
     * interruptor existe para evitar. Zero desliga a escada.
     *
     * Uma hora por padrão: numa clínica a atendente passa esse tempo no balcão
     * sem abrir o computador, e aí ela está ocupada de verdade — lead que cai
     * para quem não vai olhar é pior que lead na fila geral.
     */
    minutosParaAusente: number
}

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
    minutosParaAusente: 60,
}

export function readAutomations(value: Prisma.JsonValue | null | undefined): Automations {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_AUTOMATIONS

    const raw = value as Record<string, unknown>
    const hour = Number(raw.briefingHour)

    /**
     * A política vem de JSON, então **tudo** é desconhecido até ser conferido.
     * Estratégia inválida vira `nenhuma` em vez de lançar: configuração
     * estragada não pode derrubar o atendimento, só deixar de distribuir.
     */
    const dist = (raw.distribuicao ?? {}) as Record<string, unknown>
    const estrategias: EstrategiaDeDistribuicao[] = ['nenhuma', 'rodizio', 'balanceado']
    const minutos = Number(raw.minutosParaAusente)

    return {
        followUpTasks: typeof raw.followUpTasks === 'boolean' ? raw.followUpTasks : DEFAULT_AUTOMATIONS.followUpTasks,
        briefing: typeof raw.briefing === 'boolean' ? raw.briefing : DEFAULT_AUTOMATIONS.briefing,
        briefingHour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_AUTOMATIONS.briefingHour,
        distribuicao: {
            estrategia: estrategias.includes(dist.estrategia as EstrategiaDeDistribuicao)
                ? (dist.estrategia as EstrategiaDeDistribuicao)
                : POLITICA_PADRAO.estrategia,
            soDisponiveis:
                typeof dist.soDisponiveis === 'boolean' ? dist.soDisponiveis : POLITICA_PADRAO.soDisponiveis,
        },
        minutosParaAusente:
            Number.isInteger(minutos) && minutos >= 0 ? minutos : DEFAULT_AUTOMATIONS.minutosParaAusente,
    }
}
