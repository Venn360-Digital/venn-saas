import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import prisma from '@venn/db/cliente'
import { BRAND } from '@venn/core/marca'
import { membroOuLogin } from '@venn/core/lib/indice-servidor'
import { lerCampos, lerConfiguracao } from '@venn/core/lib/formularios/schema'

import { EditorDeFormulario } from './EditorDeFormulario'

/**
 * O editor de um formulário de captura.
 *
 * Tela própria, não diálogo — como o funil de marketing: o desenho precisa da
 * largura para mostrar os campos de um lado e a prévia do outro, e a prévia é
 * o componente **real** da página pública, não um desenho dele.
 *
 * As listas de apoio (origens, etiquetas, pessoas) vêm do servidor junto do
 * formulário, para os combos não nascerem vazios no primeiro clique.
 */
export default async function FormularioEditorPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const membro = await membroOuLogin()

    const [form, origens, etiquetas, pessoas, h] = await Promise.all([
        prisma.leadForm.findFirst({
            where: { id, workspaceId: membro.workspaceId },
            include: { _count: { select: { submissions: true } } },
        }),
        prisma.origin.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: { name: 'asc' },
            select: { id: true, name: true },
        }),
        prisma.tag.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, color: true },
        }),
        prisma.workspaceUser.findMany({
            where: { workspaceId: membro.workspaceId, isActive: true },
            orderBy: { user: { name: 'asc' } },
            select: { userId: true, user: { select: { name: true, lastName: true } } },
        }),
        headers(),
    ])

    if (!form) notFound()

    /**
     * O endereço público do formulário, montado como o `widget.js` monta o
     * seu: a variável do ambiente primeiro, depois o host encaminhado. Atrás
     * do proxy o host cru é o do contêiner, e um link `http://0.0.0.0:3000/f/…`
     * colado no site da organização não abre para ninguém.
     */
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
    const proto = h.get('x-forwarded-proto') ?? 'https'
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || (host ? `${proto}://${host}` : '')).replace(/\/+$/, '')

    return (
        <EditorDeFormulario
            formulario={{
                id: form.id,
                name: form.name,
                status: form.status,
                publicKey: form.publicKey,
                campos: lerCampos(form.fields),
                config: lerConfiguracao(form.settings),
                originId: form.originId,
                assignedUserId: form.assignedUserId,
                envios: form._count.submissions,
            }}
            organizacao={membro.workspaceId}
            origens={origens}
            etiquetas={etiquetas}
            pessoas={pessoas.map((p) => ({
                userId: p.userId,
                name: [p.user.name, p.user.lastName].filter(Boolean).join(' ') || 'Sem nome',
            }))}
            baseUrl={baseUrl}
            marca={BRAND().name}
        />
    )
}
