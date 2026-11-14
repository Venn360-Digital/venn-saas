import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { assertConversationAccess, getWorkspaceMember } from '@/lib/auth/workspace'
import { comEnderecoDeMidia } from '@/lib/midia'

/**
 * Tudo o que foi trocado em arquivo nesta conversa.
 *
 * Rota própria porque a conversa carrega as últimas mensagens, e um exame
 * enviado em março não está entre elas — procurá-lo significava rolar o
 * histórico inteiro. Aqui a consulta filtra por `mediaUrl` no banco, então o
 * painel abre com os arquivos de toda a conversa sem baixar o resto.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    if (!(await assertConversationAccess(id, auth.member))) {
        return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    }

    const files = await prisma.message.findMany({
        where: { conversationId: id, mediaUrl: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            direction: true,
            content: true,
            contentType: true,
            mediaUrl: true,
            createdAt: true,
        },
    })

    // O endereço é cunhado **aqui**, depois de `assertConversationAccess` —
    // é o que faz o link nascer válido e nunca existir em repouso.
    return NextResponse.json({ files: await comEnderecoDeMidia(files) })
}
