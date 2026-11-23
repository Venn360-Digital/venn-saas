import 'server-only'

import type { Prisma } from '@venn/db'
import prisma from '@venn/db/cliente'

import {
    CANAL_DO_DOCUMENTO,
    CONTEUDO_DOCUMENTO,
    REMETENTE_SISTEMA,
    chaveDoEvento,
    textoDoEnvio,
    textoDoEvento,
    type EventoDoDocumento,
} from './eventos'
import { ehTipoDeDocumento, type TipoDeDocumento } from './estados'

/**
 * O documento em Conversas — a parte que grava.
 *
 * A regra está em `eventos.ts`. Aqui: um fio por contato no canal `email`, a
 * mensagem do envio, e os eventos do que o cliente fez com o link.
 *
 * Nada aqui lança para fora: registrar em Conversas é consequência, e falhar
 * nela não pode desfazer um envio que já saiu nem uma abertura que já
 * aconteceu. O erro vai para o log.
 */

type Cliente = Prisma.TransactionClient | typeof prisma

function tipoDe(kind: string): TipoDeDocumento {
    return ehTipoDeDocumento(kind) ? kind : 'proposta'
}

/**
 * O fio do documento deste contato — o que já existe, ou um novo.
 *
 * `atendidaPor: 'humano'` e com dono: a conversa é de quem enviou. Sem dono
 * ela cairia na fila "com a equipe, sem responsável", de onde se puxa trabalho
 * — e um registro de envio não é trabalho pendente.
 */
export async function conversaDoDocumento(
    db: Cliente,
    entrada: { workspaceId: string; contactId: string; donoId: string | null }
): Promise<{ id: string }> {
    const existente = await db.conversation.findFirst({
        where: { workspaceId: entrada.workspaceId, contactId: entrada.contactId, channel: CANAL_DO_DOCUMENTO },
        select: { id: true },
    })
    if (existente) return existente

    return db.conversation.create({
        data: {
            workspaceId: entrada.workspaceId,
            contactId: entrada.contactId,
            channel: CANAL_DO_DOCUMENTO,
            status: 'active',
            atendidaPor: 'humano',
            assignedTo: entrada.donoId,
            ownerAssignedAt: entrada.donoId ? new Date() : null,
            ownerSource: entrada.donoId ? 'manual' : null,
            lastMessageAt: new Date(),
        },
        select: { id: true },
    })
}

/** A mensagem que registra o envio por e-mail. */
export async function registrarEnvioNaConversa(entrada: {
    workspaceId: string
    contactId: string
    userId: string
    kind: string
    numero: number
    para: string
    url: string
}): Promise<void> {
    try {
        const conversa = await conversaDoDocumento(prisma, {
            workspaceId: entrada.workspaceId,
            contactId: entrada.contactId,
            donoId: entrada.userId,
        })
        const agora = new Date()
        await prisma.message.create({
            data: {
                conversationId: conversa.id,
                direction: 'outbound',
                content: textoDoEnvio(tipoDe(entrada.kind), entrada.numero, entrada.para, entrada.url),
                contentType: CONTEUDO_DOCUMENTO,
                sentBy: entrada.userId,
                status: 'sent',
            },
        })
        await prisma.conversation.update({
            where: { id: conversa.id },
            data: { status: 'active', lastMessageAt: agora },
        })
    } catch (error) {
        console.error('[DOCUMENTO_CONVERSA_ENVIO]', error)
    }
}

/**
 * O evento do cliente ("abriu", "aceitou") no fio do documento.
 *
 * Idempotente pela chave em `externalId`: a segunda abertura do mesmo link não
 * gera segunda linha. Lê o que precisa a partir do link, para a página pública
 * não ter de carregar nada além da projeção mínima.
 */
export async function registrarEventoDoDocumento(
    db: Cliente,
    entrada: { shareId: string; evento: EventoDoDocumento; nome?: string | null }
): Promise<void> {
    try {
        const chave = chaveDoEvento(entrada.shareId, entrada.evento)
        const existente = await db.message.findFirst({ where: { externalId: chave }, select: { id: true } })
        if (existente) return

        const share = await db.proposalShare.findUnique({
            where: { id: entrada.shareId },
            select: {
                userId: true,
                revision: {
                    select: {
                        proposal: {
                            select: {
                                kind: true,
                                number: true,
                                workspaceId: true,
                                userId: true,
                                deal: { select: { contactId: true } },
                            },
                        },
                    },
                },
            },
        })
        const proposta = share?.revision.proposal
        if (!proposta?.deal.contactId) return

        const conversa = await conversaDoDocumento(db, {
            workspaceId: proposta.workspaceId,
            contactId: proposta.deal.contactId,
            donoId: share?.userId ?? proposta.userId ?? null,
        })
        const agora = new Date()
        await db.message.create({
            data: {
                conversationId: conversa.id,
                direction: 'internal',
                isInternal: true,
                content: textoDoEvento(entrada.evento, tipoDe(proposta.kind), proposta.number, entrada.nome),
                contentType: 'text',
                sentBy: REMETENTE_SISTEMA,
                externalId: chave,
                status: 'sent',
            },
        })
        await db.conversation.update({ where: { id: conversa.id }, data: { lastMessageAt: agora } })
    } catch (error) {
        console.error('[DOCUMENTO_CONVERSA_EVENTO]', error)
    }
}
