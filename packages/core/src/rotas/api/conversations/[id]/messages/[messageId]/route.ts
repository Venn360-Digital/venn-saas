import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { resolveConversationLine } from '@venn/core/lib/conversation-line'
import { usuarioDaSessao } from '@venn/core/lib/auth/sessao'
import { conversationScope, currentMembership, type WorkspaceRole } from '@venn/core/lib/auth/workspace'
import { MINUTOS_PARA_EDITAR, podeEditarAinda, resolveIntegration } from '@venn/core/lib/whatsapp'
import { avisarConversaAlterada, publicarAgora } from '@venn/core/lib/outbox/avisar'

/**
 * Apagar para todos (`DELETE`) e editar (`PATCH`) uma mensagem já enviada.
 *
 * ## Por que isto existe só agora
 *
 * A clínica pediu as duas no primeiro dia de uso, e a resposta foi "o provedor
 * não oferece". **Estava errado**: o Evolution Go expõe `POST /message/delete` e
 * `POST /message/edit` desde antes da versão que rodamos — conferido no fonte da
 * tag 0.7.2, que é a imagem dos três VPS. A conclusão anterior saiu de ler a
 * lista de endpoints que *nós chamávamos* como se fosse a lista do que o
 * servidor expõe.
 *
 * ## As três recusas, e cada uma tem razão diferente
 *
 * 1. **Só o que nós enviamos.** Apagar para todos e editar são operações do
 *    autor: o WhatsApp não deixa ninguém mexer na mensagem de outra pessoa.
 *    Então `direction` tem de ser `outbound` e tem de haver `externalId` — sem
 *    ele o provedor nunca confirmou o envio e não há o que apontar.
 * 2. **Só onde o canal permite.** No oficial (Cloud API) a Meta não oferece
 *    nenhuma das duas, e no Instagram também não. Quem decide é a presença do
 *    método no provedor, não um `if` por nome de canal — assim um canal futuro
 *    que passe a oferecer entra sem tocar nesta rota.
 * 3. **Só texto, e só dentro de quinze minutos**, para editar. O limite de
 *    tempo é do WhatsApp; a restrição a texto é do Evolution Go, que traz
 *    `// TODO: edit MediaMessage too` ao lado da própria rota.
 *
 * Para **apagar** não há conferência de prazo aqui, de propósito. O WhatsApp tem
 * um limite, mas quem o conhece é ele: cravar um número nosso recusaria
 * apagamentos que teriam funcionado. A recusa sobe do provedor com o motivo
 * dele.
 */

/** O que as duas operações precisam resolver antes de falar com o provedor. */
async function carregar(conversationId: string, messageId: string) {
    const workspaceUser = await currentMembership()
    if (!workspaceUser) {
        return { erro: NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 }) }
    }

    const message = await prisma.message.findFirst({
        where: {
            id: messageId,
            conversationId,
            conversation: {
                workspaceId: workspaceUser.workspaceId,
                ...conversationScope({
                    role: workspaceUser.role as WorkspaceRole,
                    departmentIds: workspaceUser.departmentIds,
                    userId: workspaceUser.userId,
                }),
            },
        },
        include: {
            conversation: {
                include: { contact: { select: { phone: true, instagramId: true } } },
            },
        },
    })

    if (!message) {
        return { erro: NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 }) }
    }

    if (message.isInternal || message.direction !== 'outbound' || !message.externalId) {
        return {
            erro: NextResponse.json(
                { error: 'Só é possível alterar mensagens que a equipe enviou' },
                { status: 400 }
            ),
        }
    }

    if (message.deletedAt) {
        return { erro: NextResponse.json({ error: 'Esta mensagem já foi apagada' }, { status: 400 }) }
    }

    /**
     * O destinatário pelo canal do fio, e a linha por onde a mensagem saiu.
     *
     * Tem de ser a mesma linha: o WhatsApp só aceita apagar ou editar de quem
     * enviou, e enviar o pedido por outro número é pedir em nome de estranho.
     */
    const destino =
        message.conversation.channel === 'instagram'
            ? message.conversation.contact?.instagramId
            : message.conversation.contact?.phone

    const line = await resolveConversationLine(message.conversation)

    if (!line.ok || !destino) {
        return {
            erro: NextResponse.json(
                {
                    error: !destino
                        ? 'Conversa sem destinatário'
                        : line.ok
                          ? 'Conversa sem canal ativo'
                          : line.reason === 'line_offline'
                            ? `${line.label} está desconectada`
                            : 'Nenhuma linha conectada',
                },
                { status: 400 }
            ),
        }
    }

    return { workspaceUser, message, destino, line }
}

/** Avisa a tela, pelo caminho que ela já escuta. */
async function avisarATela(workspaceId: string, conversationId: string) {
    await prisma.$transaction(async (tx) => {
        await avisarConversaAlterada(tx, { workspaceId, conversationId })
    })
    publicarAgora()
}

/** Apagar para todos. */
export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string; messageId: string }> }
) {
    try {
        const { id: conversationId, messageId } = await params
        const ctx = await carregar(conversationId, messageId)
        if ('erro' in ctx) return ctx.erro
        const { workspaceUser, message, destino, line } = ctx

        const { provider, credentials } = resolveIntegration(line.integration)
        if (!provider.revoke) {
            return NextResponse.json(
                { error: 'O canal desta conversa não permite apagar mensagens enviadas' },
                { status: 400 }
            )
        }

        await provider.revoke(credentials, destino, message.externalId as string)

        await prisma.message.update({
            where: { id: message.id },
            data: { deletedAt: new Date() },
        })

        /**
         * Quem apagou fica registrado **dentro da conversa**.
         *
         * A bolha passa a dizer "Mensagem apagada" e isso basta para o paciente;
         * para a clínica, não. Apagar uma mensagem que já saiu é gesto que a
         * próxima pessoa a abrir o fio precisa poder explicar — e a nota interna
         * é o mesmo lugar onde a recusa da janela do Instagram já é registrada.
         */
        const quem = await usuarioDaSessao()
        await prisma.message.create({
            data: {
                conversationId,
                direction: 'internal',
                content: `${quem?.nome || quem?.email || 'A equipe'} apagou uma mensagem enviada.`,
                contentType: 'text',
                isInternal: true,
                status: 'sent',
                sentBy: workspaceUser.userId,
            },
        })

        await avisarATela(workspaceUser.workspaceId, conversationId)
        return NextResponse.json({ id: message.id, deletedAt: new Date().toISOString() })
    } catch (error) {
        console.error('[MESSAGE_DELETE]', error)
        /**
         * O motivo do provedor sobe, cortado.
         *
         * É quase sempre a janela de tempo do WhatsApp, e "Erro ao apagar" não
         * diria isso. Cortado porque o corpo do erro do Evolution traz JSON
         * inteiro, que não cabe num aviso de tela.
         */
        const motivo = error instanceof Error ? error.message.slice(0, 200) : ''
        return NextResponse.json(
            { error: motivo || 'Não foi possível apagar a mensagem' },
            { status: 502 }
        )
    }
}

/** Editar o texto. */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; messageId: string }> }
) {
    try {
        const { id: conversationId, messageId } = await params

        const body = (await request.json().catch(() => ({}))) as { content?: string }
        const texto = typeof body.content === 'string' ? body.content.trim() : ''
        if (!texto) {
            return NextResponse.json({ error: 'O texto não pode ficar vazio' }, { status: 400 })
        }

        const ctx = await carregar(conversationId, messageId)
        if ('erro' in ctx) return ctx.erro
        const { workspaceUser, message, destino, line } = ctx

        if (message.contentType !== 'text') {
            return NextResponse.json(
                { error: 'Só mensagens de texto podem ser editadas' },
                { status: 400 }
            )
        }

        if (!podeEditarAinda(message.createdAt)) {
            return NextResponse.json(
                { error: `O WhatsApp só permite editar nos primeiros ${MINUTOS_PARA_EDITAR} minutos` },
                { status: 400 }
            )
        }

        const { provider, credentials } = resolveIntegration(line.integration)
        if (!provider.editText) {
            return NextResponse.json(
                { error: 'O canal desta conversa não permite editar mensagens enviadas' },
                { status: 400 }
            )
        }

        await provider.editText(credentials, destino, message.externalId as string, texto)

        const atualizada = await prisma.message.update({
            where: { id: message.id },
            data: { content: texto, editedAt: new Date() },
            select: { id: true, content: true, editedAt: true },
        })

        await avisarATela(workspaceUser.workspaceId, conversationId)
        return NextResponse.json(atualizada)
    } catch (error) {
        console.error('[MESSAGE_EDIT]', error)
        const motivo = error instanceof Error ? error.message.slice(0, 200) : ''
        return NextResponse.json(
            { error: motivo || 'Não foi possível editar a mensagem' },
            { status: 502 }
        )
    }
}
