import { requireWritable } from '@/lib/billing'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MissingRedisUrlError, QUEUE, getQueue } from '@/lib/queue'
import { resolveConversationLine } from '@/lib/conversation-line'
import { conversationScope, currentMembership, type WorkspaceRole } from '@/lib/auth/workspace'
import { avisarMensagemNova } from '@/lib/outbox/avisar'

// POST: Human sends a message (text or media) in a conversation
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: conversationId } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

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

            // Upload to Supabase Storage
            const fileExt = fileName.split('.').pop() || 'bin'
            const storagePath = `${workspaceUser.workspaceId}/${conversationId}/${Date.now()}.${fileExt}`
            const buffer = Buffer.from(await file.arrayBuffer())

            // `storage.objects` tem RLS ligado e nenhuma política: com a sessão
            // do usuário todo upload falhava com "new row violates row-level
            // security policy", e foi por isso que imagem e áudio nunca saíram.
            // A autorização já aconteceu acima (membro ativo do workspace, via
            // Prisma); o Storage recebe o cliente administrativo, como o worker
            // faz ao arquivar mídia recebida.
            const storage = createAdminClient().storage
            const { data: uploadData, error: uploadError } = await storage
                .from('attachments')
                .upload(storagePath, buffer, {
                    contentType: mime,
                    upsert: false,
                })

            if (uploadError) {
                console.error('[SEND_MESSAGE] Upload failed:', uploadError)
                return NextResponse.json({ error: 'Falha ao enviar arquivo' }, { status: 500 })
            }

            // Get public URL
            const { data: urlData } = storage
                .from('attachments')
                .getPublicUrl(uploadData.path)

            mediaUrl = urlData.publicUrl

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
                }),
            },
            include: { contact: true },
        })

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
        const { message } = await prisma.$transaction(async (tx) => {
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
                    assignedTo: conversation.assignedTo || user.id,
                }
            })

            await avisarMensagemNova(tx, {
                workspaceId: workspaceUser.workspaceId,
                conversationId,
                messageId: criada.id,
                direction: isInternal ? 'internal' : 'outbound',
            })

            return { message: criada }
        })

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

                    await getQueue(QUEUE.WHATSAPP_OUTBOUND).add(
                        'send-operator-message',
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
                        // One send per message row, so a retried request cannot
                        // double-post.
                        // "-" e não ":": o BullMQ recusa ids custom com dois-pontos.
                        { jobId: `send-${message.id}` }
                    )
                } catch (error) {
                    const reason =
                        error instanceof MissingRedisUrlError
                            ? 'fila indisponível (REDIS_URL)'
                            : 'falha ao enfileirar'
                    console.error(`[SEND_MESSAGE] ${reason}:`, error)
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
            senderName: senderUser?.name || 'Atendente',
            // Presente só quando a mensagem foi gravada e não saiu.
            ...(lineWarning ? { warning: lineWarning } : {}),
        })
    } catch (error) {
        console.error('[SEND_MESSAGE] Error:', error)
        return NextResponse.json({ error: 'Erro ao enviar mensagem' }, { status: 500 })
    }
}
