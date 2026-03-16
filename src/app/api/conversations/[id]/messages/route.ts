import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { evolutionAPI } from '@/lib/whatsapp/evolution-api'

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

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
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

            const { data: uploadData, error: uploadError } = await supabase.storage
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
            const { data: urlData } = supabase.storage
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

            if (!textContent) {
                return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 })
            }
        }

        // Get conversation with contact and agent integration
        const conversation = await prisma.conversation.findFirst({
            where: {
                id: conversationId,
                workspaceId: workspaceUser.workspaceId,
            },
            include: {
                contact: true,
                agent: {
                    include: {
                        integrations: {
                            where: { channel: 'whatsapp_qr', status: 'connected' }
                        }
                    }
                }
            }
        })

        if (!conversation) {
            return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
        }

        // Save message to DB
        const message = await prisma.message.create({
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

        // Update conversation
        await prisma.conversation.update({
            where: { id: conversationId },
            data: {
                lastMessageAt: new Date(),
                assignedTo: conversation.assignedTo || user.id,
            }
        })

        // Send via WhatsApp if channel is whatsapp (skip for internal notes)
        if (!isInternal && conversation.channel === 'whatsapp' && conversation.contact.phone) {
            const whatsappIntegration = conversation.agent?.integrations?.[0]
            if (whatsappIntegration) {
                const config = whatsappIntegration.config as { instanceName: string }
                try {
                    let sendResult: { key: { id: string } } | null = null

                    if (contentType === 'text') {
                        sendResult = await evolutionAPI.sendTextMessage(
                            config.instanceName,
                            conversation.contact.phone,
                            textContent
                        )
                    } else if (contentType === 'audio' && mediaUrl) {
                        sendResult = await evolutionAPI.sendAudio(
                            config.instanceName,
                            conversation.contact.phone,
                            mediaUrl
                        )
                    } else if (mediaUrl) {
                        const mediatype = contentType === 'image' ? 'image'
                            : contentType === 'video' ? 'video'
                                : 'document'
                        sendResult = await evolutionAPI.sendMedia(
                            config.instanceName,
                            conversation.contact.phone,
                            mediaUrl,
                            mediatype,
                            textContent !== `📷 Imagem` && textContent !== `🎬 Vídeo` && textContent !== `📄 ${fileName}` ? textContent : undefined,
                            fileName
                        )
                    }

                    // Save the externalId from WhatsApp response — needed for delivery status tracking
                    const externalId = sendResult?.key?.id || null
                    await prisma.message.update({
                        where: { id: message.id },
                        data: {
                            status: 'sent',
                            ...(externalId ? { externalId } : {}),
                        }
                    })
                } catch (error) {
                    console.error('[SEND_MESSAGE] WhatsApp send failed:', error)
                    await prisma.message.update({
                        where: { id: message.id },
                        data: { status: 'failed' }
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
        })
    } catch (error) {
        console.error('[SEND_MESSAGE] Error:', error)
        return NextResponse.json({ error: 'Erro ao enviar mensagem' }, { status: 500 })
    }
}
