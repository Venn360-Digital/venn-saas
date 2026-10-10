import type { Prisma } from '@prisma/client'

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
    briefingWhatsApp: boolean
}

export const DEFAULT_AUTOMATIONS: Automations = {
    // Ligada por padrão porque não envia nada a paciente: só organiza a agenda
    // de quem atende, e nenhuma fase cobra enquanto não tiver prazo definido.
    followUpTasks: true,
    briefing: true,
    briefingHour: 8,
    briefingWhatsApp: false,
}

export function readAutomations(value: Prisma.JsonValue | null | undefined): Automations {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_AUTOMATIONS

    const raw = value as Record<string, unknown>
    const hour = Number(raw.briefingHour)

    return {
        followUpTasks: typeof raw.followUpTasks === 'boolean' ? raw.followUpTasks : DEFAULT_AUTOMATIONS.followUpTasks,
        briefing: typeof raw.briefing === 'boolean' ? raw.briefing : DEFAULT_AUTOMATIONS.briefing,
        briefingHour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_AUTOMATIONS.briefingHour,
        briefingWhatsApp:
            typeof raw.briefingWhatsApp === 'boolean' ? raw.briefingWhatsApp : DEFAULT_AUTOMATIONS.briefingWhatsApp,
    }
}
