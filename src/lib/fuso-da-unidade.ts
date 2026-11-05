import 'server-only'

import prisma from '@/lib/prisma'
import { FUSO_DO_NEGOCIO } from '@/lib/fuso'
import { FUSOS } from '@/lib/fusos'

/**
 * O fuso em que uma unidade opera — o relógio do negócio dela.
 *
 * ## Por que por unidade, e não por pessoa
 *
 * Decisão do Andre em 2026-11-04. Duas pessoas da mesma unidade precisam
 * concordar sobre que dia é hoje: senão o mesmo compromisso cai em dias
 * diferentes no relatório de cada uma, o briefing dispara duas vezes e
 * "atividade atrasada" quer dizer coisas diferentes na mesma tela.
 *
 * E para a agenda do Google o fuso de quem olha seria **errado**, não só
 * insuficiente: o evento guarda um instante absoluto, e o `timeZone` que
 * mandamos serve para interpretar a hora de parede. Gravar no fuso de quem
 * marcou faria 9h virar instantes diferentes conforme quem clicou — mudaria a
 * hora do atendimento, não a forma de exibi-la. Quem mostra a cada pessoa no
 * relógio dela é o próprio Google, sem nós.
 *
 * ## **Este não é o fuso do agente.** Os dois existem, e de propósito
 *
 * `Agent.timezone` continua sendo outra coisa, e o Andre pediu explicitamente
 * para mantê-lo (2026-11-04). Ele é o relógio com que o **agente conversa**:
 * é o que faz a IA responder "amanhã às 9h" sabendo que horas são para quem
 * está do outro lado. Configura-se em Treinamento → Perfil, por agente, porque
 * uma unidade pode ter agentes atendendo públicos diferentes.
 *
 * O desta aqui é o relógio do **negócio**: o que é hoje, quando o briefing sai,
 * quando abre a janela de expediente, e que instante vai para a agenda do
 * Google.
 *
 * Eles vão coincidir quase sempre, e **não devem ser unificados**: juntá-los
 * tiraria da unidade com dois públicos a capacidade de ter um agente em cada
 * fuso, que é justamente o que o campo do agente existe para dar.
 *
 * ## Onde mora, e por que não há migração
 *
 * Em `Workspace.settings`, que é `Json?`, já existe e **já está documentado no
 * schema** como "Tema, idioma, fuso horário" — a coluna foi criada prevendo
 * isto e nunca tinha sido lida. Mesma escolha do widget, pelo mesmo motivo: a
 * produção dos clones ainda não tem caminho para rodar migração.
 *
 * ## Nunca lança, e nunca devolve fuso inválido
 *
 * Um fuso que o runtime não conhece faz `Intl` lançar, e isto é lido em cron,
 * em dashboard e no caminho de gravar um evento na agenda — lugares em que uma
 * exceção custa muito mais do que uma hora errada. Valor desconhecido cai no
 * padrão, que é o comportamento de antes desta coluna ser lida.
 */

/** A chave dentro de `Workspace.settings`. */
const CHAVE = 'fusoHorario'

/** Só o que a tela oferece entra — a lista é a mesma de `lib/fusos.ts`. */
function valido(v: unknown): v is string {
    return typeof v === 'string' && FUSOS.some((f) => f.value === v)
}

export function lerFusoDasConfiguracoes(settings: unknown): string {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return FUSO_DO_NEGOCIO
    }
    const v = (settings as Record<string, unknown>)[CHAVE]
    return valido(v) ? v : FUSO_DO_NEGOCIO
}

/**
 * Se a unidade **declarou** o fuso, em vez de estar caindo no padrão.
 *
 * `lerFusoDasConfiguracoes` não distingue as duas coisas — devolve São Paulo nos
 * dois casos —, e para o cadastro a diferença é tudo: ele grava o fuso inicial
 * na conta que nasce, e não pode passar por cima da unidade que já escolheu
 * outro. Esta rota roda duas vezes no fluxo normal.
 */
export function temFusoNasConfiguracoes(settings: unknown): boolean {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return false
    }
    return valido((settings as Record<string, unknown>)[CHAVE])
}

/** O que gravar de volta em `settings`, preservando o que já estava lá. */
export function comFusoNasConfiguracoes(
    settings: unknown,
    fuso: string
): Record<string, unknown> {
    const base =
        settings && typeof settings === 'object' && !Array.isArray(settings)
            ? (settings as Record<string, unknown>)
            : {}

    // Fuso fora da lista não grava: a tela só oferece os conhecidos, e aceitar
    // texto livre aqui deixaria `Intl` lançar lá na frente, longe daqui.
    return valido(fuso) ? { ...base, [CHAVE]: fuso } : base
}

/**
 * O fuso de uma unidade, pelo id.
 *
 * Uma consulta pequena, e ela aparece em caminho quente (cron por unidade,
 * dashboard). Quem percorre muitas unidades deve preferir
 * `lerFusoDasConfiguracoes` sobre o `settings` que já carregou, em vez de
 * chamar isto numa volta de laço.
 */
export async function fusoDaUnidade(workspaceId: string): Promise<string> {
    try {
        const w = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { settings: true },
        })
        return lerFusoDasConfiguracoes(w?.settings)
    } catch {
        return FUSO_DO_NEGOCIO
    }
}
