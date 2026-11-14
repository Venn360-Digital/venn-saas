import 'server-only'

import { APP } from '@/config/app.config'
import { sendEmail } from '../email/send'
import { BRAND_HEX } from '../palette'
import prisma from '@venn/db/cliente'
import { createLogger } from '../../trabalhos/registro'

const log = createLogger('ALERTA:LINHA')

/**
 * Avisa o suporte quando uma linha de WhatsApp cai — e quando ela volta.
 *
 * Existe por um caso medido: em 03/11/2026 os dois números da Odontobox ficaram
 * **13 horas fora do ar** sem ninguém saber. O app detectava (a tela mostrava
 * "Conexão perdida (detectado na verificação)") e até tentava reatar a cada dez
 * minutos, mas o aviso dependia de alguém abrir aquela tela. Detectar sem
 * avisar é o mesmo que não detectar, para quem não está olhando.
 *
 * **Só os caminhos automáticos chamam isto.** Linha que o usuário desligou, ou
 * que o limite do plano derrubou, não é incidente — é o sistema obedecendo, e
 * avisar ali treinaria o suporte a ignorar o aviso. Por isso a função pede o
 * status anterior e sai calada quando a queda não vem de `connected`.
 *
 * **Por que também avisar o retorno.** A verificação de dez minutos reata
 * sozinha quando o provedor ainda guarda o JID, então uma parte das quedas se
 * cura antes de alguém agir. Sem o aviso de volta, o suporte iria atrás de um
 * incidente que já acabou. O par queda/retorno se fecha sozinho.
 *
 * Nunca lança: o chamador é um cron ou um consumidor de fila, e derrubar o
 * conserto da linha para entregar o aviso seria trocar o essencial pelo
 * acessório. `sendEmail` já devolve `{ ok: false }` em vez de lançar quando o
 * binding não existe; o `catch` aqui cobre o resto.
 */
const DESTINO = process.env.ALERT_EMAIL ?? 'suporte@venn360.com'

type Origem = 'webhook' | 'verificacao'

/** De onde veio o sinal, em português, para quem lê o e-mail às 3 da manhã. */
const COMO: Record<Origem, string> = {
    webhook: 'o provedor avisou na hora (webhook de conexão)',
    verificacao: 'a verificação de dez minutos encontrou',
}

async function contexto(integrationId: string, agentId: string) {
    const agente = await prisma.agent
        .findUnique({
            where: { id: agentId },
            select: { name: true, workspace: { select: { name: true } } },
        })
        .catch(() => null)
    return {
        agente: agente?.name ?? '(agente desconhecido)',
        workspace: agente?.workspace?.name ?? '(workspace desconhecido)',
        integrationId,
    }
}

function moldura(titulo: string, cor: string, linhas: string[]): string {
    return (
        `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">` +
        `<p style="font-size:16px;font-weight:600;color:${cor};margin:0 0 12px">${titulo}</p>` +
        `<table cellpadding="4" style="border-collapse:collapse">${linhas.join('')}</table>` +
        `</div>`
    )
}

const campo = (rotulo: string, valor: string) =>
    `<tr><td style="color:${BRAND_HEX.slate}">${rotulo}</td><td><strong>${valor}</strong></td></tr>`

/** A identificação do ambiente vem primeiro: são 3 apps × 2 ambientes. */
const identidade = () => [
    campo('Produto', `${APP.slug} / ${APP.env}`),
    campo('Endereço', APP.url ?? '(sem url)'),
]

export async function avisarQuedaDeLinha(input: {
    integrationId: string
    agentId: string
    statusAnterior: string
    label: string | null
    phoneNumber: string | null
    origem: Origem
    tentouReatar: boolean
}): Promise<void> {
    // Queda só é queda a partir de "no ar". `pending` nunca chegou a funcionar.
    if (input.statusAnterior !== 'connected') return

    try {
        const ctx = await contexto(input.integrationId, input.agentId)
        const html = moldura('Linha de WhatsApp fora do ar', BRAND_HEX.red, [
            ...identidade(),
            campo('Linha', input.label || ctx.integrationId),
            campo('Número', input.phoneNumber || '(não pareado)'),
            campo('Agente', ctx.agente),
            campo('Workspace', ctx.workspace),
            campo('Como soubemos', COMO[input.origem]),
            campo(
                'Reconexão automática',
                input.tentouReatar
                    ? 'tentada e não funcionou — precisa de gente'
                    : 'não tentada; a verificação de dez minutos vai tentar'
            ),
            campo('Quando', new Date().toISOString()),
        ])

        const r = await sendEmail({
            to: DESTINO,
            subject: `[${APP.slug}/${APP.env}] WhatsApp fora do ar: ${input.label || ctx.integrationId}`,
            html,
        })
        if (!r.ok) log.error(`não consegui avisar a queda de ${input.integrationId}: ${r.error}`)
        else log.warn(`suporte avisado da queda de ${input.integrationId}`)
    } catch (error) {
        log.error(`falha ao montar o aviso de queda de ${input.integrationId}`, error)
    }
}

export async function avisarRetornoDeLinha(input: {
    integrationId: string
    agentId: string
    statusAnterior: string
    label: string | null
    phoneNumber: string | null
    origem: Origem
}): Promise<void> {
    // Só fecha o par quando houve queda avisada antes.
    if (input.statusAnterior !== 'disconnected') return

    try {
        const ctx = await contexto(input.integrationId, input.agentId)
        const html = moldura('Linha de WhatsApp voltou', BRAND_HEX.mintDeep, [
            ...identidade(),
            campo('Linha', input.label || ctx.integrationId),
            campo('Número', input.phoneNumber || '(não pareado)'),
            campo('Agente', ctx.agente),
            campo('Workspace', ctx.workspace),
            campo('Como soubemos', COMO[input.origem]),
            campo('Quando', new Date().toISOString()),
        ])

        const r = await sendEmail({
            to: DESTINO,
            subject: `[${APP.slug}/${APP.env}] WhatsApp voltou: ${input.label || ctx.integrationId}`,
            html,
        })
        if (!r.ok) log.error(`não consegui avisar o retorno de ${input.integrationId}: ${r.error}`)
    } catch (error) {
        log.error(`falha ao montar o aviso de retorno de ${input.integrationId}`, error)
    }
}
