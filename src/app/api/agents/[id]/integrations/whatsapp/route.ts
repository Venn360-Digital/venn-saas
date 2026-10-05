import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'
import type { AgentIntegration } from '@prisma/client'
import {
    CHANNEL_PROVIDER,
    WhatsAppProviderError,
    evolutionGo,
    type IntegrationConfig,
    readIntegrationConfig,
    resolveIntegration,
    toJsonConfig,
    webhookUrlFor,
} from '@/lib/whatsapp'

/**
 * WhatsApp QR channel, served by Evolution Go (whatsmeow).
 *
 * Evolution Go splits what Evolution API v2 did in one call: creation is an
 * admin-key operation that mints the per-instance token, and connecting is a
 * per-instance call that carries the webhook URL and event subscription. The token
 * is the only way to address the instance afterwards, so persisting it is the
 * critical step here.
 */

const CHANNEL = 'whatsapp_qr'

async function resolveWorkspace(userId: string): Promise<string | null> {
    const workspaceUser = await prisma.workspaceUser.findFirst({
        where: { userId },
        select: { workspaceId: true },
    })
    return workspaceUser?.workspaceId ?? null
}

function instanceNameFor(workspaceId: string, agentId: string): string {
    return `kaly_${workspaceId}_${agentId}`.substring(0, 50)
}

async function persistConfig(
    agentId: string,
    status: string,
    config: IntegrationConfig
): Promise<AgentIntegration> {
    return prisma.agentIntegration.upsert({
        where: { agentId_channel: { agentId, channel: CHANNEL } },
        create: { agentId, channel: CHANNEL, status, config: toJsonConfig(config) },
        update: { status, config: toJsonConfig(config), errorMessage: null },
    })
}

// POST: create (or recover) the instance, connect it, and return a QR code
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

        const workspaceId = await resolveWorkspace(user.id)
        if (!workspaceId) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        const agent = await prisma.agent.findFirst({
            where: { id: agentId, workspaceId },
            select: { id: true },
        })
        if (!agent) return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })

        const existing = await prisma.agentIntegration.findUnique({
            where: { agentId_channel: { agentId, channel: CHANNEL } },
        })

        if (existing?.status === 'connected') {
            return NextResponse.json(
                { error: 'WhatsApp já está conectado', status: 'connected' },
                { status: 400 }
            )
        }

        const instanceName = instanceNameFor(workspaceId, agentId)
        const stored = (existing?.config ?? {}) as Partial<IntegrationConfig>

        let credentials: IntegrationConfig = {
            instanceName,
            instanceId: stored.instanceId,
            token: stored.token,
        }

        // Provision only when we have no usable token; re-creating would orphan
        // the existing instance.
        if (!credentials.token) {
            try {
                const created = await evolutionGo.createInstance(instanceName)
                credentials = {
                    instanceName: created.instanceName,
                    instanceId: created.instanceId,
                    token: created.token,
                }
            } catch (error) {
                if (!(error instanceof WhatsAppProviderError) || !error.isConflict) throw error

                // The name is taken by an instance whose token we lost. /instance/all
                // is the only place the token is exposed, so recover it there.
                const recovered = await evolutionGo.findInstanceByName(instanceName)
                if (!recovered?.token) {
                    return NextResponse.json(
                        {
                            error:
                                'A instância existe no Evolution Go mas o token não pôde ser ' +
                                'recuperado. Remova a instância no painel do Evolution Go e tente de novo.',
                        },
                        { status: 409 }
                    )
                }
                credentials = recovered
            }
        }

        // Persist before connecting: if /instance/connect fails we must not lose
        // the token, or the instance becomes unreachable.
        await persistConfig(agentId, 'pending', credentials)

        const state = await evolutionGo.getConnectionState(credentials).catch(() => null)

        if (state?.connected) {
            const integration = await prisma.agentIntegration.update({
                where: { agentId_channel: { agentId, channel: CHANNEL } },
                data: {
                    status: 'connected',
                    connectedAt: new Date(),
                    lastActiveAt: new Date(),
                    errorMessage: null,
                    config: toJsonConfig({ ...credentials, phoneNumber: state.phoneNumber ?? credentials.phoneNumber }),
                },
            })

            return NextResponse.json({
                success: true,
                integration: { id: integration.id, status: 'connected' },
                qrcode: null,
                alreadyConnected: true,
            })
        }

        await evolutionGo.connect(credentials, webhookUrlFor(CHANNEL_PROVIDER[CHANNEL]))

        const qr = await evolutionGo.getQrCode(credentials).catch(() => null)
        const integration = await persistConfig(agentId, 'pending', credentials)

        return NextResponse.json({
            success: true,
            integration: { id: integration.id, status: integration.status },
            // The socket may not have produced a QR yet; the modal polls GET.
            qrcode: qr?.base64 ?? null,
            pairingCode: qr?.code ?? null,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro desconhecido'
        console.error('[WHATSAPP_INTEGRATION] Error:', message, error)
        return NextResponse.json({ error: `Erro ao conectar WhatsApp: ${message}` }, { status: 500 })
    }
}

// GET: connection status, plus a fresh QR while still pairing
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

        const workspaceId = await resolveWorkspace(user.id)
        if (!workspaceId) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        const integration = await prisma.agentIntegration.findFirst({
            where: { agentId, channel: CHANNEL, agent: { workspaceId } },
        })

        if (!integration) {
            return NextResponse.json({ status: 'disconnected', connected: false })
        }

        let credentials: IntegrationConfig
        try {
            credentials = readIntegrationConfig(integration)
        } catch {
            return NextResponse.json({
                status: integration.status,
                connected: integration.status === 'connected',
                errorMessage: 'Integração sem configuração válida; reconecte.',
                phoneNumber: null,
            })
        }

        try {
            const { provider } = resolveIntegration(integration)
            const state = await provider.getConnectionState(credentials)

            const phoneNumber = state.phoneNumber ?? credentials.phoneNumber ?? null

            if (state.connected) {
                if (integration.status !== 'connected' || phoneNumber !== credentials.phoneNumber) {
                    await prisma.agentIntegration.update({
                        where: { id: integration.id },
                        data: {
                            status: 'connected',
                            connectedAt: integration.connectedAt ?? new Date(),
                            lastActiveAt: new Date(),
                            errorMessage: null,
                            config: toJsonConfig({ ...credentials, phoneNumber: phoneNumber ?? undefined }),
                        },
                    })
                }

                return NextResponse.json({
                    status: 'connected',
                    connected: true,
                    lastActiveAt: integration.lastActiveAt,
                    phoneNumber,
                })
            }

            // Still pairing: hand back the current QR so the modal can refresh it
            // as Evolution Go rotates it.
            const qr = await provider.getQrCode(credentials).catch(() => null)

            return NextResponse.json({
                status: integration.status,
                connected: false,
                lastActiveAt: integration.lastActiveAt,
                phoneNumber,
                qrcode: qr?.base64 ?? null,
                pairingCode: qr?.code ?? null,
            })
        } catch (error) {
            // Provider unreachable: report what the database knows rather than failing.
            console.error('[WHATSAPP_INTEGRATION] State check failed:', error)
            return NextResponse.json({
                status: integration.status,
                connected: integration.status === 'connected',
                errorMessage: integration.errorMessage,
                phoneNumber: credentials.phoneNumber ?? null,
            })
        }
    } catch (error) {
        console.error('[WHATSAPP_INTEGRATION] Error:', error)
        return NextResponse.json({ error: 'Erro ao verificar status' }, { status: 500 })
    }
}

// DELETE: disconnect and remove the provider-side instance
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

        const workspaceId = await resolveWorkspace(user.id)
        if (!workspaceId) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        const integration = await prisma.agentIntegration.findFirst({
            where: { agentId, channel: CHANNEL, agent: { workspaceId } },
        })

        if (!integration) {
            return NextResponse.json({ error: 'Integração não encontrada' }, { status: 404 })
        }

        try {
            const { provider, credentials } = resolveIntegration(integration)
            await provider.deleteInstance(credentials)
        } catch (error) {
            // A provider-side instance we cannot delete must not block the local
            // disconnect; it is reclaimed by name on the next connect.
            console.error('[WHATSAPP_INTEGRATION] Error deleting instance:', error)
        }

        await prisma.agentIntegration.update({
            where: { id: integration.id },
            data: {
                status: 'disconnected',
                connectedAt: null,
                // Drop the token: a deleted instance's token is dead, and keeping it
                // would make the next connect skip provisioning.
                config: toJsonConfig({ instanceName: instanceNameFor(workspaceId, agentId) }),
            },
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[WHATSAPP_INTEGRATION] Error:', error)
        return NextResponse.json({ error: 'Erro ao desconectar' }, { status: 500 })
    }
}
