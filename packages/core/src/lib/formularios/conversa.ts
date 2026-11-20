import 'server-only'

import prisma from '@venn/db/cliente'

import { darDono } from '../conversas/dono'
import { hasWhatsApp, phoneVariants } from '../intake'
import { enqueueOutboundText } from '../../trabalhos/servicos/outbound'
import { createLogger } from '../../trabalhos/registro'

const log = createLogger('FORM-CONVERSA')

/**
 * O lead do formulário entrando no atendimento.
 *
 * ## Por que QR e oficial não fazem a mesma coisa
 *
 * Pedido do Andre em 20/11/2026: "se o contato possuir um WhatsApp válido, já
 * entra em conversas, atendimento com IA, e inicia um fluxo de mensagens do
 * agente. Analise como seria essa regra para WhatsApp QR e WhatsApp API."
 *
 * A análise, e ela decide o desenho:
 *
 * - **QR (`whatsapp_qr`)**: dá para escrever a quem nunca escreveu. É o que o
 *   "Novo atendimento → Ativo" já faz, e o que PRODUCT.md §8 autoriza —
 *   "texto livre para quem não escreveu só sai pelo canal QR". Então a
 *   conversa nasce **com a IA** (`atendidaPor: 'bot'`), a saudação do agente
 *   sai na hora, e a partir da resposta da pessoa o fluxo é o de qualquer
 *   conversa: o `whatsapp-inbound` agenda a resposta do modelo. Não se agenda
 *   resposta da IA aqui de propósito — sem fala da pessoa o modelo não tem a
 *   que responder, e a saudação **é** a abertura.
 *
 * - **Oficial da Meta (`whatsapp_business`)**: não dá. Fora da janela de 24h a
 *   Meta exige template aprovado (HSM), e o projeto não tem nenhum — é o mesmo
 *   muro que para o Broadcast e o passo de WhatsApp do funil
 *   (`lib/funil/acoes.ts`). Fingir que dá produziria mensagem recusada pela
 *   API com o lead achando que foi atendido. Então a conversa abre **para a
 *   equipe** (`atendidaPor: 'humano'`), com o resumo do formulário em nota
 *   interna e **nada enviado**. Quando a pessoa escrever, cai no fluxo normal
 *   e a IA assume. No dia em que houver um template aprovado de boas-vindas,
 *   é aqui que ele entra — e só aqui.
 *
 * ## O que esta função garante
 *
 * Nunca lança: captar o lead é o que importa, e uma conversa que não abriu não
 * pode custar a ficha nem o negócio. Devolve o que o chamador precisa saber —
 * quem ficou responsável e por qual linha —, ou `null` quando não houve
 * conversa.
 */

export interface ConversaDoLead {
    conversationId: string
    /** Quem a distribuição escolheu, ou `null` (fica na fila geral). */
    responsavel: string | null
    integrationId: string
    /** `true` quando a saudação do agente saiu — só no canal QR. */
    saudacaoEnviada: boolean
}

/** A linha por onde falar: o QR primeiro, porque é a única que pode abrir conversa. */
async function linhaParaOLead(workspaceId: string) {
    const qr = await prisma.agentIntegration.findFirst({
        where: { channel: 'whatsapp_qr', status: 'connected', agent: { workspaceId } },
        orderBy: { connectedAt: 'desc' },
        include: { agent: { select: { id: true, initialMessage: true, isActive: true } } },
    })
    if (qr) return { linha: qr, podeAbrirConversa: true as const }

    const oficial = await prisma.agentIntegration.findFirst({
        where: { channel: 'whatsapp_business', status: 'connected', agent: { workspaceId } },
        orderBy: { connectedAt: 'desc' },
        include: { agent: { select: { id: true, initialMessage: true, isActive: true } } },
    })
    if (oficial) return { linha: oficial, podeAbrirConversa: false as const }

    return null
}

export async function iniciarConversaDoLead(entrada: {
    workspaceId: string
    contato: { id: string; phone: string | null }
    formulario: { id: string; name: string }
    /** As respostas em texto, para a nota interna que abre o fio. */
    resumo: string
}): Promise<ConversaDoLead | null> {
    const { workspaceId, contato, formulario, resumo } = entrada

    try {
        // Sem telefone não há conversa de WhatsApp. Quem deixou só o e-mail
        // entra como ficha e negócio, e isso é o certo.
        if (!contato.phone) return null

        const canal = await linhaParaOLead(workspaceId)
        if (!canal) {
            log.info(`workspace ${workspaceId} sem linha de WhatsApp conectada; lead sem conversa`)
            return null
        }

        /**
         * O número tem WhatsApp?
         *
         * `undefined` é "não deu para verificar" — instância fora do ar,
         * provedor lento — e nesse caso **segue**: é a regra da casa para esta
         * verificação (ver `hasWhatsApp` e PRODUCT.md §8, "verificação
         * indisponível vira aviso, não impedimento"). Só o `false` explícito
         * impede, porque aí sabemos que a mensagem não chegaria.
         */
        const { exists, canonical } = await hasWhatsApp(workspaceId, contato.phone)
        if (exists === false) {
            log.info(`contato ${contato.id} sem WhatsApp; lead sem conversa`)
            return null
        }

        // A forma que o WhatsApp endereça, quando a verificação a devolveu.
        const destino = canonical ?? contato.phone
        if (canonical && canonical !== contato.phone) {
            await prisma.contact
                .update({ where: { id: contato.id }, data: { phone: canonical } })
                .catch(() => { /* outra ficha já tem o número canônico; segue com o digitado */ })
        }

        /**
         * O fio que a pessoa já tem, se tiver — um contato tem um fio, não um
         * por formulário. Fechado, reabre: é o que o inbound faz quando ela
         * volta a escrever.
         */
        const anterior = await prisma.conversation.findFirst({
            where: { workspaceId, contactId: contato.id },
            orderBy: [{ status: 'asc' }, { lastMessageAt: 'desc' }],
            select: { id: true, integrationId: true, agentId: true, assignedTo: true },
        })

        const integrationId = anterior?.integrationId ?? canal.linha.id
        const agentId = anterior?.agentId ?? canal.linha.agentId
        const agora = new Date()

        /**
         * Com a IA só no QR. No oficial a conversa é da equipe: deixá-la como
         * `bot` faria o portão da IA prometer um atendimento que não pode
         * começar — ela não tem como falar primeiro ali.
         */
        const atendidaPor = canal.podeAbrirConversa ? 'bot' : 'humano'

        const conversa = anterior
            ? await prisma.conversation.update({
                  where: { id: anterior.id },
                  data: { status: 'active', integrationId, agentId, lastMessageAt: agora },
                  select: { id: true, assignedTo: true },
              })
            : await prisma.conversation.create({
                  data: {
                      workspaceId,
                      contactId: contato.id,
                      agentId,
                      integrationId,
                      channel: 'whatsapp',
                      status: 'active',
                      atendidaPor,
                      lastMessageAt: agora,
                  },
                  select: { id: true, assignedTo: true },
              })

        /**
         * A nota interna com as respostas — o fio não abre vazio.
         *
         * Mesma escolha do "Novo atendimento → Ligação": a atividade guarda o
         * registro estruturado (aqui, o envio do formulário), e a nota põe o
         * relato onde se lê a conversa. Sem ela, quem abrir este fio amanhã vê
         * uma conversa sem motivo.
         */
        await prisma.message.create({
            data: {
                conversationId: conversa.id,
                direction: 'internal',
                content: `Lead do formulário "${formulario.name}"\n${resumo}`.slice(0, 4000),
                contentType: 'text',
                isInternal: true,
                status: 'sent',
            },
        })

        /**
         * O responsável, pela política da conta — e `darDono` é quem a aplica.
         *
         * Idempotente por construção (ele exige `assignedTo: null`), então
         * reabrir o fio de quem já tem dono não redistribui: "reabrir não
         * redistribui" é regra do produto, e vale aqui também.
         */
        const responsavel = conversa.assignedTo ?? (await darDono({
            workspaceId,
            conversationId: conversa.id,
            integrationId,
        }))

        /**
         * A saudação, só no QR e só em fio novo.
         *
         * Em fio que já existia a pessoa já conversou com a clínica; abrir com
         * "olá, sou o assistente" seria apresentar-se a quem já conhece. E a
         * saudação é o que o `whatsapp-inbound` manda em conversa nova, pelo
         * mesmo campo — o texto é um só.
         */
        const saudacao = canal.linha.agent.initialMessage?.trim()
        const podeSaudar = canal.podeAbrirConversa && canal.linha.agent.isActive && !anterior && !!saudacao
        if (podeSaudar) {
            await enqueueOutboundText({
                conversationId: conversa.id,
                content: saudacao as string,
                integrationId,
                to: destino,
                sentBy: 'agent',
                agentId,
            })
            log.info(`lead do formulário ${formulario.id}: conversa ${conversa.id} aberta com a saudação`)
        } else {
            log.info(
                `lead do formulário ${formulario.id}: conversa ${conversa.id} aberta sem envio` +
                    `${canal.podeAbrirConversa ? '' : ' (canal oficial exige template aprovado)'}`
            )
        }

        return {
            conversationId: conversa.id,
            responsavel: responsavel ?? null,
            integrationId,
            saudacaoEnviada: podeSaudar,
        }
    } catch (erro) {
        // Captar o lead é o que importa: a ficha e o negócio seguem sem a conversa.
        log.warn(`não deu para abrir a conversa do lead: ${String(erro)}`)
        return null
    }
}

export { phoneVariants }
