import { requireWritable } from '@venn/core/lib/billing'
import { NextRequest, NextResponse } from 'next/server'
import { comoReferencia, enderecoDaMidia } from '@venn/core/lib/midia'
import prisma from '@venn/db/cliente'
import { usuarioDaSessao } from '@venn/core/lib/auth/sessao'
import { QUEUE } from '@venn/core/lib/queue/definitions'
import { entregar } from '@venn/core/lib/queue/entregar'
import { CLASSES } from '@venn/core/lib/storage'
import { arquivar } from '@venn/core/trabalhos/servicos/arquivo'
import { resolveConversationLine } from '@venn/core/lib/conversation-line'
import { conversationScope, currentMembership, type WorkspaceRole } from '@venn/core/lib/auth/workspace'
import { avisarMensagemNova , publicarAgora } from '@venn/core/lib/outbox/avisar'
import { aplicarMencao } from '@venn/core/lib/conversas/colaborar'
import { transmitir } from '@venn/core/trabalhos/tempo-real'

// POST: Human sends a message (text or media) in a conversation
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: conversationId } = await params
        /**
         * Esta rota era a **única** da API ainda presa ao provedor de identidade
         * e ao storage da plataforma anterior, e a única com `getQueue()` do
         * BullMQ no caminho do atendente. Medido em 2026-10-23, no Worker: a
         * variável de endereço daquela plataforma
         * não existe lá, então a sessão vinha nula e a resposta era 401 — a
         * atendente digitava e a mensagem não saía da caixa, com a linha
         * pareada e o resto do sistema no ar. Portada para `usuarioDaSessao`,
         * para o storage da aplicação e para a costura de fila.
         */
        const user = await usuarioDaSessao()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        // A lapsed trial keeps the whole history readable and keeps messages
        // arriving — what stops is replying. See PRODUCT.md §3.
        const writable = await requireWritable(workspaceUser.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

        // Detect if request is FormData (file upload) or JSON (text message)
        const contentTypeHeader = request.headers.get('content-type') || ''
        const isMultipart = contentTypeHeader.includes('multipart/form-data')

        let textContent = ''
        let contentType = 'text'
        let mediaUrl: string | null = null
        let fileName: string | undefined
        let replyToId: string | undefined
        let isInternal = false

        if (isMultipart) {
            const formData = await request.formData()
            const file = formData.get('file') as File | null
            textContent = (formData.get('caption') as string) || ''
            replyToId = (formData.get('replyToId') as string) || undefined

            if (!file) {
                return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })
            }

            // Determine content type
            const mime = file.type
            fileName = file.name
            if (mime.startsWith('image/')) contentType = 'image'
            else if (mime.startsWith('audio/')) contentType = 'audio'
            else if (mime.startsWith('video/')) contentType = 'video'
            else contentType = 'file'

            /**
             * Mesmo destino e mesma classe da mídia que **chega** (ver
             * `trabalhos/servicos/media.ts` e `speech.ts`): anexo de conversa é
             * clínico. A extensão é saneada porque entra numa chave de objeto e
             * vem do nome do arquivo do navegador.
             */
            const fileExt =
                (fileName.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'bin'
            const chave = `${workspaceUser.workspaceId}/${conversationId}/${Date.now()}.${fileExt}`

            const arquivado = await arquivar({
                classe: CLASSES.CLINICO,
                chave,
                bytes: new Uint8Array(await file.arrayBuffer()),
                contentType: mime,
            })

            if (!arquivado) {
                // `arquivar` já registrou a causa no log.
                return NextResponse.json({ error: 'Falha ao enviar arquivo' }, { status: 500 })
            }

            // A referência, não o endereço assinado — ver `lib/midia.ts`.
            mediaUrl = comoReferencia(arquivado.referencia)

            // Set display content for DB
            if (!textContent) {
                switch (contentType) {
                    case 'image': textContent = '📷 Imagem'; break
                    case 'audio': textContent = '🎵 Áudio'; break
                    case 'video': textContent = '🎬 Vídeo'; break
                    case 'file': textContent = `📄 ${fileName}`; break
                }
            }
        } else {
            const body = await request.json()
            textContent = body.content?.trim() || ''
            replyToId = body.replyToId || undefined
            isInternal = body.isInternal === true

            // Encaminhar: copia conteúdo e mídia de uma mensagem do mesmo
            // workspace. A mídia já está no Storage, então a URL é reutilizada —
            // nenhum novo upload, e o provider a busca como faria num envio novo.
            if (typeof body.forwardFrom === 'string' && body.forwardFrom) {
                const source = await prisma.message.findFirst({
                    where: {
                        id: body.forwardFrom,
                        isInternal: false,
                        conversation: { workspaceId: workspaceUser.workspaceId },
                    },
                    select: { content: true, contentType: true, mediaUrl: true },
                })
                if (!source) {
                    return NextResponse.json({ error: 'Mensagem de origem não encontrada' }, { status: 404 })
                }
                textContent = source.content
                contentType = source.contentType
                mediaUrl = source.mediaUrl
                fileName = source.contentType === 'file' ? source.content.replace(/^📄 /, '') : fileName
            }

            if (!textContent && !mediaUrl) {
                return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 })
            }
        }

        // Get conversation with contact and agent integration
        const conversation = await prisma.conversation.findFirst({
            where: {
                id: conversationId,
                workspaceId: workspaceUser.workspaceId,
                // Escrever na conversa de outra fila é pior que lê-la.
                ...conversationScope({
                    role: workspaceUser.role as WorkspaceRole,
                    departmentIds: workspaceUser.departmentIds,
                    userId: workspaceUser.userId,
                }),
            },
            include: { contact: true },
        })

        /**
         * O fio do documento (canal `email`) não aceita resposta — ainda.
         * Gravar aqui produziria a mensagem com cara de enviada que nunca sai.
         * Nota interna pode: é registro, não envio.
         */
        if (conversation && conversation.channel === 'email' && !isInternal) {
            return NextResponse.json(
                { error: 'Este fio registra documentos enviados por e-mail; responder por ele chega numa próxima etapa.' },
                { status: 409 }
            )
        }

        if (!conversation) {
            return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
        }

        /**
         * Gravar a mensagem, mexer na conversa e avisar — tudo junto.
         *
         * Eram duas escritas soltas. Juntá-las resolve mais que o aviso: se o
         * `update` da conversa falhasse depois do `create` da mensagem, a
         * mensagem existia sem `lastMessageAt` novo, então a lista não subia a
         * conversa e a atendente não via o que ela mesma acabou de mandar.
         *
         * Um aviso só, `mensagem.nova`, e não dois: ele já faz a tela recarregar
         * a lista e a conversa aberta. Emitir `conversa.alterada` junto seria o
         * dobro de fan-out para a mesma recarga.
         */
        const { message, avisos } = await prisma.$transaction(async (tx) => {
            const criada = await tx.message.create({
                data: {
                    conversationId,
                    direction: isInternal ? 'internal' : 'outbound',
                    content: textContent,
                    contentType,
                    mediaUrl: mediaUrl || undefined,
                    sentBy: user.id,
                    replyToId: replyToId || undefined,
                    isInternal,
                }
            })

            await tx.conversation.update({
                where: { id: conversationId },
                data: {
                    lastMessageAt: new Date(),
                    /**
                     * Assumir é **responder**, nunca comentar.
                     *
                     * Este `update` não olhava `isInternal`: escrever uma nota
                     * interna gravava `assignedTo` igual a mandar mensagem
                     * para o paciente. Duas consequências, as duas ruins:
                     * `assignedTo` é o mutex do agente, então **comentar calava
                     * o bot**; e a conversa passava a constar como atendida por
                     * quem só quis deixar um recado para a colega.
                     *
                     * O Andre apontou isto em palavras exatas — "a nota interna
                     * que atribui a conversa: não pode alterar o `assignedTo`".
                     *
                     * Responder pela tela continua assumindo, e isso não é
                     * efeito colateral: é o gesto, e o mais usado de todos —
                     * foi assim que 44 das 45 conversas abertas em produção
                     * ganharam responsável. Por isso os dois campos andam
                     * juntos e os dois ficam atrás do mesmo `if`.
                     */
                    ...(isInternal
                        ? {}
                        : {
                              assignedTo: conversation.assignedTo || user.id,
                              atendidaPor: 'humano',
                          }),
                }
            })

            /**
             * A menção da nota interna, **dentro da mesma transação**.
             *
             * Só em nota interna: marcar `@colega` numa mensagem que vai para o
             * paciente mandaria a sintaxe `@[Ana](cku…)` pelo WhatsApp. A nota
             * é o único lugar onde a marcação faz sentido, e é onde o
             * respond.io a põe também.
             *
             * Se isto falhar, a nota não existe — de propósito. Seguidor sem a
             * nota que o explica é linha órfã; nota sem o seguidor é um pedido
             * de ajuda que ninguém recebeu. As duas juntas ou nenhuma.
             */
            let avisos: { recadoId: string; toUserId: string }[] = []
            if (isInternal) {
                const efeito = await aplicarMencao(tx, {
                    workspaceId: workspaceUser.workspaceId,
                    conversationId,
                    messageId: criada.id,
                    texto: textContent,
                    autorId: user.id,
                    donoId: conversation.assignedTo ?? null,
                })
                avisos = efeito.avisos
                if (efeito.recusados.length) {
                    console.warn(
                        `[MENCAO] ${efeito.recusados.length} marcação(ões) recusada(s) na nota ${criada.id}`
                    )
                }
            }

            await avisarMensagemNova(tx, {
                workspaceId: workspaceUser.workspaceId,
                conversationId,
                messageId: criada.id,
                direction: isInternal ? 'internal' : 'outbound',
            })

            return { message: criada, avisos }
        })

        publicarAgora()

        /**
         * O sino do colega marcado, **depois do commit** e pelo caminho efêmero
         * — o mesmo do recado manual (`api/equipe/recados`). Até 20/11/2026 a
         * menção gravava o recado e não emitia nada: o crachá só mudava na
         * próxima navegação. Perder o evento não perde o recado, que está
         * gravado; é por isso que não vai pelo outbox.
         */
        for (const aviso of avisos) {
            await transmitir({
                workspaceId: workspaceUser.workspaceId,
                tipo: 'recado',
                dados: { recadoId: aviso.recadoId, deUserId: user.id },
                paraUsuario: aviso.toUserId,
            })
        }

        /**
         * Para onde a resposta do atendente vai, pelo canal do fio.
         *
         * O WhatsApp endereça por telefone; o Instagram, pelo IGSID. Antes isto
         * era só `contact.phone`, e um fio de Direct caía fora do `if` em
         * silêncio: a mensagem ficava gravada na conversa, com cara de enviada,
         * e nunca saía.
         *
         * Nota interna não sai por canal nenhum, por definição.
         */
        const destino =
            conversation.channel === 'instagram'
                ? conversation.contact.instagramId
                : conversation.channel === 'whatsapp'
                  ? conversation.contact.phone
                  : null

        let lineWarning: string | null = null
        if (!isInternal && destino) {
            // Pela linha deste fio, não por `integrations[0]`: com dois números
            // na clínica, responder pela outra linha manda a mensagem de um
            // número que o paciente não reconhece. Ver resolveConversationLine.
            const line = await resolveConversationLine(conversation)
            if (!line.ok) {
                // A mensagem fica gravada e visível — o que falha é a entrega, e
                // a tela precisa dizer isso em vez de mostrar um envio que não
                // aconteceu. Antes este caminho era um `if` sem `else`: a
                // mensagem aparecia na conversa e nunca saía.
                lineWarning =
                    line.reason === 'line_offline'
                        ? `A mensagem foi gravada, mas ${line.label} está desconectada e nada foi enviado.`
                        : conversation.channel === 'instagram'
                          ? 'A mensagem foi gravada, mas nenhuma conta de Instagram está conectada.'
                          : 'A mensagem foi gravada, mas nenhum número de WhatsApp está conectado.'
                await prisma.message.update({
                    where: { id: message.id },
                    data: { status: 'failed' },
                })
            } else {
                // Queued rather than sent inline: the operator's message gets the
                // same retry and provider-resolution the agent's replies get, and a
                // flaky provider call no longer loses the text. The row is already
                // persisted, so the inbox shows it immediately and Realtime carries
                // the status change from pending to sent.
                const captionIsPlaceholder =
                    textContent === '📷 Imagem' ||
                    textContent === '🎬 Vídeo' ||
                    textContent === `📄 ${fileName}`

                const kind =
                    contentType === 'text' ? 'text' as const
                        : contentType === 'audio' ? 'audio' as const
                            : 'media' as const

                // O mimetype vive só no bloco de upload e nunca chegava ao job, então o
                // worker caía em `document` para tudo que não fosse áudio — a imagem
                // chegava ao paciente como arquivo para baixar. O tipo já está
                // resolvido em `contentType` (upload e encaminhar); vai explícito.
                const mediaKind =
                    contentType === 'image' ? 'image' as const
                        : contentType === 'video' ? 'video' as const
                            : contentType === 'audio' ? 'audio' as const
                                : contentType === 'file' ? 'document' as const
                                    : undefined

                try {
                    await prisma.message.update({
                        where: { id: message.id },
                        data: { status: 'pending' },
                    })

                    await entregar(
                        QUEUE.WHATSAPP_OUTBOUND,
                        {
                            messageId: message.id,
                            integrationId: line.integration.id,
                            to: destino,
                            kind,
                            mediaKind,
                            content: captionIsPlaceholder && kind !== 'text' ? '' : textContent,
                            mediaUrl: mediaUrl || undefined,
                            fileName: fileName || undefined,
                        },
                        {
                            nome: 'send-operator-message',
                            // Um envio por linha de mensagem. No BullMQ é este
                            // `jobId` ("-" e não ":", que ele recusa); no Queues a
                            // mesma garantia é o `messageId` em IDS_DE_DEDUP.
                            jobId: `send-${message.id}`,
                        }
                    )
                } catch (error) {
                    console.error('[SEND_MESSAGE] falha ao enfileirar:', error)
                    await prisma.message.update({
                        where: { id: message.id },
                        data: { status: 'failed' },
                    })
                }
            }
        }

        // Get sender name
        const senderUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { name: true }
        })

        // Re-fetch message with replyTo included
        const fullMessage = await prisma.message.findUnique({
            where: { id: message.id },
            include: {
                replyTo: {
                    select: {
                        id: true,
                        content: true,
                        direction: true,
                        contentType: true,
                        sentBy: true,
                    }
                }
            }
        })

        return NextResponse.json({
            ...fullMessage,
            // O endereço assinado na hora. Sem isto a mensagem que acabou de
            // ser enviada mostraria `ref:clinico:...` no lugar da imagem — o
            // ponto de saída mais visível dos três.
            mediaUrl: await enderecoDaMidia(fullMessage?.mediaUrl),
            senderName: senderUser?.name || 'Atendente',
            // Presente só quando a mensagem foi gravada e não saiu.
            ...(lineWarning ? { warning: lineWarning } : {}),
        })
    } catch (error) {
        console.error('[SEND_MESSAGE] Error:', error)
        return NextResponse.json({ error: 'Erro ao enviar mensagem' }, { status: 500 })
    }
}
