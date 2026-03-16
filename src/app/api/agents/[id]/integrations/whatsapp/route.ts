import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'
import { evolutionAPI } from '@/lib/whatsapp/evolution-api'

// POST: Create WhatsApp connection and get QR Code
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        // Verify agent belongs to user's workspace
        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        const agent = await prisma.agent.findFirst({
            where: { id: agentId, workspaceId: workspaceUser.workspaceId }
        })

        if (!agent) {
            return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
        }

        // Check if integration already exists
        let integration = await prisma.agentIntegration.findUnique({
            where: { agentId_channel: { agentId, channel: 'whatsapp_qr' } }
        })

        // Instance name: workspace_agent for uniqueness
        const instanceName = `kaly_${workspaceUser.workspaceId}_${agentId}`.substring(0, 50)

        if (integration && integration.status === 'connected') {
            return NextResponse.json({
                error: 'WhatsApp já está conectado',
                status: 'connected'
            }, { status: 400 })
        }

        let result
        let qrcodeData: string | null = null

        try {
            // Try creating a new instance
            result = await evolutionAPI.createInstance(instanceName)
            qrcodeData = result.qrcode?.base64 || null
        } catch (createError: any) {
            // Instance already exists (403) - try to reconnect
            if (createError.message?.includes('403') || createError.message?.includes('already in use')) {
                console.log('[WHATSAPP_INTEGRATION] Instance exists, trying to reconnect...')

                // Check current state
                try {
                    const state = await evolutionAPI.getConnectionState(instanceName)
                    if (state.instance.state === 'open') {
                        // Already connected, update DB and return
                        integration = await prisma.agentIntegration.upsert({
                            where: { agentId_channel: { agentId, channel: 'whatsapp_qr' } },
                            create: {
                                agentId,
                                channel: 'whatsapp_qr',
                                status: 'connected',
                                config: { instanceName },
                            },
                            update: {
                                status: 'connected',
                                connectedAt: new Date(),
                                lastActiveAt: new Date(),
                                errorMessage: null,
                            }
                        })

                        return NextResponse.json({
                            success: true,
                            integration: { id: integration.id, status: 'connected' },
                            qrcode: null,
                            alreadyConnected: true,
                        })
                    }
                } catch {
                    // State check failed, continue to get QR
                }

                // Not connected — get a new QR code
                try {
                    const qr = await evolutionAPI.getQRCode(instanceName)
                    qrcodeData = qr.base64 || null
                } catch {
                    // If connect also fails, delete and recreate
                    console.log('[WHATSAPP_INTEGRATION] Connect failed, deleting and recreating...')
                    try {
                        await evolutionAPI.deleteInstance(instanceName)
                    } catch { /* ignore delete errors */ }

                    result = await evolutionAPI.createInstance(instanceName)
                    qrcodeData = result.qrcode?.base64 || null
                }
            } else {
                throw createError
            }
        }

        // Upsert integration record
        integration = await prisma.agentIntegration.upsert({
            where: { agentId_channel: { agentId, channel: 'whatsapp_qr' } },
            create: {
                agentId,
                channel: 'whatsapp_qr',
                status: 'pending',
                config: {
                    instanceName,
                    instanceId: result?.instance?.instanceId,
                    hash: result?.hash,
                }
            },
            update: {
                status: 'pending',
                config: {
                    instanceName,
                    instanceId: result?.instance?.instanceId,
                    hash: result?.hash,
                },
                errorMessage: null,
            }
        })

        return NextResponse.json({
            success: true,
            integration: {
                id: integration.id,
                status: integration.status,
            },
            qrcode: qrcodeData,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro desconhecido'
        console.error('[WHATSAPP_INTEGRATION] Error:', message, error)
        return NextResponse.json({ error: `Erro ao conectar WhatsApp: ${message}` }, { status: 500 })
    }
}

// GET: Check connection status
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params
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

        const integration = await prisma.agentIntegration.findFirst({
            where: {
                agentId,
                channel: 'whatsapp_qr',
                agent: { workspaceId: workspaceUser.workspaceId }
            }
        })

        if (!integration) {
            return NextResponse.json({
                status: 'disconnected',
                connected: false
            })
        }

        // Check actual status from Evolution API
        const config = integration.config as Record<string, any> | null
        if (config?.instanceName) {
            try {
                const state = await evolutionAPI.getConnectionState(config.instanceName)
                const isConnected = state.instance.state === 'open'

                let phoneNumber = config.phoneNumber as string | undefined

                // If connected and no phone stored, fetch it
                if (isConnected && !phoneNumber) {
                    try {
                        const instances = await evolutionAPI.fetchInstances(config.instanceName)
                        if (instances.length > 0 && instances[0].ownerJid) {
                            phoneNumber = instances[0].ownerJid.replace('@s.whatsapp.net', '')

                            // Store phone in config
                            await prisma.agentIntegration.update({
                                where: { id: integration.id },
                                data: {
                                    config: { ...config, phoneNumber }
                                }
                            })
                        }
                    } catch {
                        // ignore fetch errors
                    }
                }

                // Update DB if status changed
                if (isConnected && integration.status !== 'connected') {
                    await prisma.agentIntegration.update({
                        where: { id: integration.id },
                        data: {
                            status: 'connected',
                            connectedAt: new Date(),
                            lastActiveAt: new Date()
                        }
                    })
                }

                return NextResponse.json({
                    status: isConnected ? 'connected' : integration.status,
                    connected: isConnected,
                    lastActiveAt: integration.lastActiveAt,
                    phoneNumber: phoneNumber || null,
                })
            } catch (err) {
                console.error('[WHATSAPP_INTEGRATION] Evolution API state check failed:', err)
                // Evolution API not available, return DB status
            }
        }

        return NextResponse.json({
            status: integration.status,
            connected: integration.status === 'connected',
            errorMessage: integration.errorMessage,
            phoneNumber: (config as any)?.phoneNumber || null,
        })
    } catch (error) {
        console.error('[WHATSAPP_INTEGRATION] Error:', error)
        return NextResponse.json({ error: 'Erro ao verificar status' }, { status: 500 })
    }
}

// DELETE: Disconnect WhatsApp
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params
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

        const integration = await prisma.agentIntegration.findFirst({
            where: {
                agentId,
                channel: 'whatsapp_qr',
                agent: { workspaceId: workspaceUser.workspaceId }
            }
        })

        if (!integration) {
            return NextResponse.json({ error: 'Integração não encontrada' }, { status: 404 })
        }

        // Delete from Evolution API
        const config = integration.config as { instanceName?: string } | null
        if (config?.instanceName) {
            try {
                await evolutionAPI.deleteInstance(config.instanceName)
            } catch (err) {
                console.error('[WHATSAPP_INTEGRATION] Error deleting instance:', err)
            }
        }

        // Update status in DB
        await prisma.agentIntegration.update({
            where: { id: integration.id },
            data: {
                status: 'disconnected',
                connectedAt: null,
            }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[WHATSAPP_INTEGRATION] Error:', error)
        return NextResponse.json({ error: 'Erro ao desconectar' }, { status: 500 })
    }
}
