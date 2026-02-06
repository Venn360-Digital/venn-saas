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

        // Create or reconnect instance
        const result = await evolutionAPI.createInstance(instanceName)

        // Upsert integration record
        integration = await prisma.agentIntegration.upsert({
            where: { agentId_channel: { agentId, channel: 'whatsapp_qr' } },
            create: {
                agentId,
                channel: 'whatsapp_qr',
                status: 'pending',
                config: {
                    instanceName,
                    instanceId: result.instance.instanceId,
                    hash: result.hash,
                }
            },
            update: {
                status: 'pending',
                config: {
                    instanceName,
                    instanceId: result.instance.instanceId,
                    hash: result.hash,
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
            qrcode: result.qrcode?.base64 ? `data:image/png;base64,${result.qrcode.base64}` : null,
        })
    } catch (error) {
        console.error('[WHATSAPP_INTEGRATION] Error:', error)
        return NextResponse.json({ error: 'Erro ao conectar WhatsApp' }, { status: 500 })
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
        const config = integration.config as { instanceName?: string } | null
        if (config?.instanceName) {
            try {
                const state = await evolutionAPI.getConnectionState(config.instanceName)
                const isConnected = state.instance.state === 'open'

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
                    lastActiveAt: integration.lastActiveAt
                })
            } catch {
                // Evolution API not available, return DB status
            }
        }

        return NextResponse.json({
            status: integration.status,
            connected: integration.status === 'connected',
            errorMessage: integration.errorMessage
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
