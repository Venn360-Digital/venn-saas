import { NextRequest, NextResponse } from 'next/server'
import { currentMembership } from '@/lib/auth/workspace'
import prisma from '@venn/db/cliente'
import { isUniqueViolation } from '@venn/db/erros'
import { normalizePhone } from '@/lib/phone'

// POST - Import contacts from CSV data
// Step 1 (preview): { action: 'preview', csvData: [...] }
// Step 2 (commit):  { action: 'commit', contacts: [...], duplicateAction: 'skip' | 'update' }
export async function POST(request: NextRequest) {
    try {
        const wu = await currentMembership()
        if (!wu) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const body = await request.json()
        const { action } = body

        if (action === 'preview') {
            return handlePreview(body.contacts, wu.workspaceId)
        }

        if (action === 'commit') {
            return handleCommit(body.contacts, body.duplicateAction || 'skip', wu.workspaceId)
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    } catch (error) {
        console.error('[CONTACTS_IMPORT]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

async function handlePreview(
    contacts: Array<{ name?: string; email?: string; phone?: string; notes?: string }>,
    workspaceId: string
) {
    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
        return NextResponse.json({ error: 'No contacts provided' }, { status: 400 })
    }

    // Telefone normalizado antes de comparar: a planilha vem com máscara, o
    // banco guarda dígitos com país, e sem isto toda linha importada parecia
    // nova — inclusive a do paciente que já estava lá.
    const phones = contacts
        .map(c => (c.phone ? normalizePhone(c.phone).digits : null))
        .filter(Boolean) as string[]
    const emails = contacts.map(c => c.email).filter(Boolean) as string[]

    const existingByPhone = phones.length > 0
        ? await prisma.contact.findMany({
            where: { workspaceId, phone: { in: phones } },
            select: { id: true, phone: true, name: true, email: true },
        })
        : []

    const existingByEmail = emails.length > 0
        ? await prisma.contact.findMany({
            where: { workspaceId, email: { in: emails } },
            select: { id: true, email: true, name: true, phone: true },
        })
        : []

    const phoneSet = new Set(existingByPhone.map(c => c.phone))
    const emailSet = new Set(existingByEmail.map(c => c.email))

    const preview = contacts.map((c, index) => {
        const phone = c.phone ? normalizePhone(c.phone).digits : null
        const isDuplicate = (phone && phoneSet.has(phone)) || (c.email && emailSet.has(c.email))
        const existingContact = existingByPhone.find(e => e.phone === phone)
            || existingByEmail.find(e => e.email === c.email)
        return {
            index,
            ...c,
            // A prévia já mostra o número como ele será gravado.
            phone: phone ?? c.phone,
            status: isDuplicate ? 'duplicate' as const : 'new' as const,
            existingId: existingContact?.id || null,
            existingName: existingContact?.name || null,
        }
    })

    const newCount = preview.filter(p => p.status === 'new').length
    const duplicateCount = preview.filter(p => p.status === 'duplicate').length

    return NextResponse.json({
        preview,
        summary: { total: contacts.length, new: newCount, duplicates: duplicateCount },
    })
}

async function handleCommit(
    contacts: Array<{
        name?: string; email?: string; phone?: string; notes?: string
        status: 'new' | 'duplicate'; existingId?: string
    }>,
    duplicateAction: 'skip' | 'update',
    workspaceId: string
) {
    let created = 0
    let updated = 0
    let skipped = 0

    for (const c of contacts) {
        // O que vai para o banco é a forma canônica, não a da planilha.
        const phone = c.phone ? normalizePhone(c.phone).digits : null

        if (c.status === 'duplicate') {
            if (duplicateAction === 'skip') {
                skipped++
                continue
            }
            if (duplicateAction === 'update' && c.existingId) {
                /**
                 * `updateMany` com `workspaceId`, e não `update` por id.
                 *
                 * `existingId` **vem do corpo da requisição** — o cliente
                 * devolve a lista que o preview montou, e nada o obriga a
                 * devolver a mesma. Com `update({ where: { id } })` e só
                 * `currentMembership()` na porta, membro de qualquer clínica
                 * sobrescrevia `name`, `email`, `phone` e `notes` de contato
                 * de **qualquer outra**, bastando conhecer o id.
                 *
                 * `updateMany` aceita o `workspaceId` no `where` (o `update`
                 * por id único não aceita) e devolve 0 em vez de levantar
                 * quando não casa — que é o comportamento certo aqui: id que
                 * não é desta clínica conta como ignorado, sem dizer ao
                 * chamador que ele existe em outro lugar.
                 */
                const { count } = await prisma.contact.updateMany({
                    where: { id: c.existingId, workspaceId },
                    data: {
                        ...(c.name && { name: c.name }),
                        ...(c.email && { email: c.email }),
                        ...(phone && { phone }),
                        ...(c.notes && { notes: c.notes }),
                    },
                })
                if (count > 0) updated++
                else skipped++
                continue
            }
        }

        // New contact
        try {
            await prisma.contact.create({
                data: {
                    workspaceId,
                    name: c.name || null,
                    email: c.email || null,
                    phone,
                    notes: c.notes || null,
                    createdVia: 'import',
                },
            })
            created++
        } catch (error) {
            // Skip unique constraint violations
            if (isUniqueViolation(error)) {
                skipped++
            } else {
                throw error
            }
        }
    }

    return NextResponse.json({ created, updated, skipped })
}
