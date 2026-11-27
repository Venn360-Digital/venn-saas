import 'server-only'

import prisma from '@venn/db/cliente'

import { resolveConversationLine } from '../conversation-line'
import { renderEmail } from '../email/layout'
import { sendEmail } from '../email/send'
import { enqueueOutboundText } from '../../trabalhos/servicos/outbound'
import { ROTULO_DO_TIPO, type TipoDeDocumento } from './estados'

/**
 * Como o documento chega ao cliente.
 *
 * ## Vai o LINK, nunca o arquivo
 *
 * Três razões, e a primeira já resolve: **nenhum dos dois caminhos de e-mail
 * deste projeto suporta anexo** — `sendEmail` aceita `{to, subject, html}`, e o
 * de campanha usa `Content.Simple` do SES, com o comentário explícito de que
 * MIME à mão só serviria para anexo.
 *
 * A segunda: no WhatsApp, `sendMedia` exige uma URL que o **provedor** vai
 * buscar, e a URL assinada do bucket privado vale 600 segundos — uma
 * retentativa de fila dez minutos depois pega 403.
 *
 * A terceira é a que importa para o produto: o link registra abertura. Um PDF
 * anexo é lido sem ninguém saber; o link diz "ele abriu três vezes e não
 * respondeu", que é o dado que muda a próxima ligação.
 *
 * ## WhatsApp só na conversa aberta
 *
 * Disparo frio está bloqueado por construção neste projeto:
 * `lib/funil/acoes.ts` recusa sempre ("o canal oficial está em revisão na
 * Meta") e `lib/marketing/lines.ts` recusa disparo em massa por linha QR,
 * porque dá ban no número **do cliente**. Então mandar pelo zap funciona
 * **dentro da janela de 24 h** de uma conversa ativa, e `conversaAberta()`
 * abaixo é o que a tela consulta para habilitar ou desabilitar o botão — com o
 * motivo à vista, nunca um botão que falha calado.
 */

/** Quanto tempo depois da última mensagem do contato o WhatsApp ainda sai. */
const JANELA_EM_HORAS = 24

export interface ConversaParaEnvio {
    conversationId: string
    /** Nulo quando há conversa na janela mas nenhuma linha serve para enviar. */
    integrationId: string | null
    to: string
    /** Por que não dá para enviar, quando `integrationId` é nulo. Vai para a tela. */
    motivoDaRecusa?: string
}

/**
 * Há conversa aberta com este contato?
 *
 * "Aberta" aqui é a janela da Meta, não o status da conversa no CRM: o que
 * conta é ter chegado mensagem **do contato** nas últimas 24 h. Uma conversa
 * marcada como aberta há três dias, sem mensagem recebida, está fora da janela
 * e o envio seria recusado pelo provedor.
 */
export async function conversaAberta(
    workspaceId: string,
    contactId: string
): Promise<ConversaParaEnvio | null> {
    const limite = new Date(Date.now() - JANELA_EM_HORAS * 60 * 60 * 1000)

    const conversa = await prisma.conversation.findFirst({
        where: {
            workspaceId,
            contactId,
            // Só WhatsApp: o link de proposta não vai por Instagram nem pelo
            // widget do site — o primeiro não aceita, e no segundo o visitante
            // está com a página aberta, onde a proposta já pode ser mostrada.
            channel: 'whatsapp',
            messages: { some: { direction: 'inbound', createdAt: { gt: limite } } },
        },
        orderBy: { updatedAt: 'desc' },
        select: {
            id: true,
            integrationId: true,
            agentId: true,
            workspaceId: true,
            channel: true,
            contact: { select: { phone: true } },
        },
    })

    if (!conversa?.contact?.phone) return null

    /**
     * A linha sai de `resolveConversationLine`, não de `integrations[0]`.
     *
     * Com dois números na unidade, responder pela outra linha manda a mensagem
     * de um número que o cliente não reconhece — e ele não vai clicar num link
     * de valor que chegou de um desconhecido. O resolvedor também recusa linha
     * desconectada, e é por isso que o botão pode dizer o motivo.
     */
    const linha = await resolveConversationLine(conversa)
    if (!linha.ok) {
        return {
            conversationId: conversa.id,
            integrationId: null,
            to: conversa.contact.phone,
            motivoDaRecusa:
                linha.reason === 'line_offline'
                    ? `${linha.label} está desconectada`
                    : 'nenhum número de WhatsApp está conectado',
        }
    }

    return {
        conversationId: conversa.id,
        integrationId: linha.integration.id,
        to: conversa.contact.phone,
    }
}

/** O texto que vai no WhatsApp. Curto: é mensagem, não carta. */
export function mensagemDeWhatsApp(
    tipo: TipoDeDocumento,
    numero: number,
    url: string,
    organizacao: string
): string {
    const rotulo = ROTULO_DO_TIPO[tipo].toLowerCase()
    return [
        `Olá! Preparamos ${rotulo === 'orçamento' ? 'o' : 'a'} ${rotulo} ${numero} para você.`,
        '',
        url,
        '',
        `Qualquer dúvida, é só responder por aqui. — ${organizacao}`,
    ].join('\n')
}

export interface EnvioPorWhatsApp {
    ok: boolean
    motivo?: string
    messageId?: string
}

/**
 * Manda o link na conversa aberta.
 *
 * Reusa `enqueueOutboundText` — o mesmo caminho do atendente digitando. Isso
 * grava a `Message` na conversa (então a mensagem aparece no histórico, do lado
 * de quem a mandou) e deixa a fila `whatsapp-outbound` cuidar do envio e da
 * retentativa. **Nenhuma fila nova**: uma fila custa quatro arquivos mais o
 * provisionamento na conta, e esta já faz exatamente este trabalho.
 */
export async function enviarPorWhatsApp(
    conversa: ConversaParaEnvio,
    texto: string,
    userId: string
): Promise<EnvioPorWhatsApp> {
    if (!conversa.integrationId) {
        return {
            ok: false,
            motivo: conversa.motivoDaRecusa ?? 'esta conversa não tem uma linha de WhatsApp conectada',
        }
    }
    try {
        const { messageId } = await enqueueOutboundText({
            conversationId: conversa.conversationId,
            content: texto,
            integrationId: conversa.integrationId,
            to: conversa.to,
            // O autor é a pessoa, não o agente: a mensagem é dela, e o evento de
            // `message.sent` do agente não deve disparar por isto.
            sentBy: userId,
        })
        return { ok: true, messageId }
    } catch (error) {
        console.error('[PROPOSTA_WHATSAPP]', error)
        return { ok: false, motivo: 'não foi possível enfileirar a mensagem' }
    }
}

/**
 * Manda o link por e-mail.
 *
 * `sendEmail` nunca lança — devolve `{ok:false, error}` — então o chamador
 * decide o que fazer. Aqui o desfecho é informado ao vendedor na tela: o link
 * **já existe** e já pode ser copiado, mesmo que o e-mail falhe. Fazer o
 * contrário (falhar o envio inteiro porque o e-mail caiu) jogaria fora um
 * token válido.
 */
export async function enviarPorEmail(entrada: {
    para: string
    tipo: TipoDeDocumento
    numero: number
    titulo: string
    url: string
    organizacao: string
    validade: Date
    responsavel: string | null
}): Promise<{ ok: boolean; error?: string }> {
    const rotulo = ROTULO_DO_TIPO[entrada.tipo]
    const artigo = entrada.tipo === 'proposta' ? 'a sua' : 'o seu'

    const corpo = [
        `${entrada.organizacao} preparou ${artigo} ${rotulo.toLowerCase()} ${entrada.numero}: <strong>${entrada.titulo}</strong>.`,
        'Abra pelo botão abaixo para ver os itens, os valores e registrar o seu aceite.',
    ]
    if (entrada.responsavel) {
        corpo.push(`Qualquer dúvida, fale com ${entrada.responsavel}.`)
    }

    const html = renderEmail({
        headline: `${rotulo} ${entrada.numero}`,
        body: corpo,
        cta: { texto: `Ver ${rotulo.toLowerCase()}`, url: entrada.url },
        // A validade sob o botão, e não no corpo: é a informação que decide se
        // a pessoa clica agora ou depois.
        sobOBotao: `O link vale até ${entrada.validade.toLocaleDateString('pt-BR')}.`,
        porque: `Você recebeu este e-mail porque ${entrada.organizacao} preparou este documento para você.`,
    })

    return sendEmail({
        to: entrada.para,
        subject: `${rotulo} ${entrada.numero} — ${entrada.organizacao}`,
        html,
    })
}
