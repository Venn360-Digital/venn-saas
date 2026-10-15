import type { Agent, AgentIntegration } from '@prisma/client'
import prisma from '@/lib/prisma'

/**
 * O widget do site: o que é público e o que não é.
 *
 * A **chave pública** vai dentro da página da clínica e qualquer um a lê. Ela
 * identifica de quem é o atendimento e **não autoriza mais nada**: tudo o que
 * permite é o que um visitante faz — abrir uma conversa e falar nela.
 *
 * A **chave do visitante** é sorteada no navegador e guardada lá. É o que separa
 * a conversa de uma pessoa da de outra. Quem tiver a chave pública da clínica
 * pode começar um atendimento novo; ninguém lê o de outra pessoa sem a chave
 * dela, que nunca trafega para fora do navegador que a criou.
 */

export type WidgetIntegration = AgentIntegration & { agent: Agent }

/** A integração de site desta chave, se existir e estiver ligada. */
export async function widgetIntegration(key: string): Promise<WidgetIntegration | null> {
    if (!key || key.length < 16) return null
    const integracao = await prisma.agentIntegration.findFirst({
        where: { publicKey: key, channel: 'site', status: 'connected' },
        include: { agent: true },
    })
    return integracao?.agent ? (integracao as WidgetIntegration) : null
}

/**
 * O widget roda no site da clínica, que é outro domínio.
 *
 * `*` porque a clínica escolhe onde cola o código e não temos como saber: a
 * origem não é o que protege nada aqui. O que protege é que a chave pública só
 * abre conversa, e a do visitante só lê a dele.
 */
export function widgetCors(): Record<string, string> {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store',
    }
}

/** Uma chave difícil de adivinhar, para a clínica ou para o visitante. */
export function novaChave(prefixo: string): string {
    const bytes = new Uint8Array(24)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${prefixo}_${hex}`
}

/**
 * Quantas mensagens um visitante pode mandar antes de a gente parar de ouvir.
 *
 * O endereço é público: sem teto, uma aba aberta num laço queimaria o crédito de
 * IA da clínica. O teto é por conversa, e quem o estoura continua podendo
 * escrever — a equipe lê —, só não aciona mais o agente.
 */
export const TETO_DE_MENSAGENS_DO_VISITANTE = 40
