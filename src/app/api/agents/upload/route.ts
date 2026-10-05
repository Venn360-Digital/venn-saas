import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assertAgentAccess, getWorkspaceMember } from '@/lib/auth/workspace'

/**
 * Upload a knowledge file for an agent.
 *
 * The previous version took `agentId` from the form body and never checked it, so
 * any authenticated user could write into any agent's folder. It also built the
 * storage path from the raw `file.name`, which let a crafted name escape the
 * agent's prefix, and imposed no size limit.
 */

const ALLOWED_TYPES = new Set([
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
])

const MAX_BYTES = 20 * 1024 * 1024

/**
 * Reduce a filename to a safe storage segment: no directory separators, no
 * traversal, no leading dots, and a bounded length.
 */
function safeFileName(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? 'arquivo'
    const cleaned = base
        .normalize('NFKD')
        .replace(/[^\w.\-]+/g, '_')
        .replace(/^\.+/, '')
        .slice(0, 120)

    return cleaned.length > 0 ? cleaned : 'arquivo'
}

export async function POST(request: NextRequest) {
    try {
        const auth = await getWorkspaceMember()
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status })
        }

        const formData = await request.formData()
        const file = formData.get('file')
        const agentId = formData.get('agentId')

        if (!(file instanceof File)) {
            return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })
        }

        if (typeof agentId !== 'string' || !agentId) {
            return NextResponse.json({ error: 'agentId obrigatório' }, { status: 400 })
        }

        const allowed = await assertAgentAccess(agentId, auth.member.workspaceId)
        if (!allowed) {
            return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
        }

        if (!ALLOWED_TYPES.has(file.type)) {
            return NextResponse.json({ error: 'Tipo de arquivo não permitido' }, { status: 400 })
        }

        if (file.size > MAX_BYTES) {
            return NextResponse.json(
                { error: `Arquivo maior que ${MAX_BYTES / 1024 / 1024} MB` },
                { status: 413 }
            )
        }

        // Workspace prefix as well as agent, so storage layout mirrors the
        // tenancy boundary rather than relying on the agent id alone.
        const path = `${auth.member.workspaceId}/${agentId}/${Date.now()}-${safeFileName(file.name)}`

        const supabase = await createClient()
        const { data, error } = await supabase.storage
            .from('agent-knowledge')
            .upload(path, file, { contentType: file.type, upsert: false })

        if (error || !data) {
            console.error('[UPLOAD_ERROR]', error)
            return NextResponse.json({ error: 'Falha no upload' }, { status: 500 })
        }

        const { data: urlData } = supabase.storage
            .from('agent-knowledge')
            .getPublicUrl(data.path)

        return NextResponse.json({
            url: urlData.publicUrl,
            path: data.path,
            filename: file.name,
            size: file.size,
            type: file.type,
        })
    } catch (error) {
        console.error('[UPLOAD_POST]', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}
