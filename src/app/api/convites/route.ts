import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { APP } from '@/config/app.config'
import { BRAND } from '@/config/brand'
import { MANAGER_ROLES, requireRole } from '@/lib/auth/workspace'
import { TEMPLATES } from '@/lib/email/templates'
import { estadoDoConvite, normalizarEmail, vencimentoDe } from '@/lib/convite/estado'
import prisma from '@/lib/prisma'
import { sendEmail } from '@/lib/email/send'
import { sortearToken } from '@/lib/convite/token'

/**
 * Os convites desta unidade: listar e criar.
 *
 * Substitui o `POST /api/users` como caminho de entrada de gente nova. A
 * diferença é de ordem, não de tela: `User` e `AuthAccount` deixam de nascer
 * quando o administrador clica e passam a nascer quando a pessoa aceita e
 * escolhe a própria senha. Ver `lib/convite/estado.ts`.
 */

const convidarSchema = z.object({
    email: z.string().email('E-mail inválido'),
    role: z.enum(['ADMIN', 'GESTOR', 'ATENDENTE']),
    departmentIds: z.array(z.string()).optional().default([]),
    canTransfer: z.boolean().default(false),
    /** Sem valor, o padrão vem do papel — a mesma regra da criação direta. */
    recebeConversas: z.boolean().optional(),
})

export async function GET() {
    const auth = await requireRole(MANAGER_ROLES)
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const convites = await prisma.invite.findMany({
        where: { workspaceId: auth.member.workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
            id: true,
            email: true,
            role: true,
            departmentIds: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
            createdAt: true,
            invitedBy: { select: { name: true, lastName: true } },
        },
    })

    const agora = new Date()
    return NextResponse.json({
        convites: convites.map((c) => ({
            id: c.id,
            email: c.email,
            role: c.role,
            departmentIds: Array.isArray(c.departmentIds) ? c.departmentIds : [],
            // O estado é derivado aqui, não lido de coluna — ver `estado.ts`.
            estado: estadoDoConvite(c, agora),
            expiresAt: c.expiresAt,
            createdAt: c.createdAt,
            convidadoPor: c.invitedBy
                ? [c.invitedBy.name, c.invitedBy.lastName].filter(Boolean).join(' ')
                : null,
        })),
    })
}

export async function POST(request: NextRequest) {
    const auth = await requireRole(MANAGER_ROLES)
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json().catch(() => null)
    const lido = convidarSchema.safeParse(body)
    if (!lido.success) {
        const primeiro = lido.error.issues[0]
        return NextResponse.json(
            { error: primeiro.message, campo: primeiro.path.join('.') },
            { status: 400 }
        )
    }

    const email = normalizarEmail(lido.data.email)
    const workspaceId = auth.member.workspaceId

    /**
     * Já é da equipe? Recusa, e com o nome do campo.
     *
     * A checagem é por `workspaceId` + e-mail do usuário, e não só pelo
     * e-mail: a mesma pessoa pode ser membro de outra unidade da conta, e isso
     * não a torna membro desta.
     */
    const jaMembro = await prisma.workspaceUser.findFirst({
        where: { workspaceId, user: { email } },
        select: { id: true, isActive: true },
    })
    if (jaMembro) {
        return NextResponse.json(
            {
                error: jaMembro.isActive
                    ? 'Essa pessoa já está na equipe.'
                    : 'Essa pessoa já está na equipe, com o acesso desativado. Reative em vez de convidar.',
                campo: 'email',
            },
            { status: 409 }
        )
    }

    /**
     * Convite pendente para o mesmo e-mail: **reaproveita a linha**.
     *
     * Convidar de novo é o gesto de quem acha que o primeiro não chegou —
     * então o certo é sortear outro token (o anterior morre na troca do
     * resumo), estender a validade e reenviar. Criar uma segunda linha deixaria
     * dois convites válidos para a mesma pessoa e uma lista que não dá para
     * ler.
     */
    const pendente = await prisma.invite.findFirst({
        where: { workspaceId, email, acceptedAt: null, revokedAt: null },
        select: { id: true },
    })

    const { token, tokenHash } = await sortearToken()
    const agora = new Date()

    // Departamentos: só os que existem **nesta** unidade. É a mesma guarda
    // anti-cross-tenant que a criação direta fazia, aplicada na entrada em vez
    // de no aceite — assim um id inválido é recusado enquanto há quem corrigir.
    const departamentos = lido.data.departmentIds.length
        ? (
              await prisma.department.findMany({
                  where: { workspaceId, id: { in: lido.data.departmentIds } },
                  select: { id: true },
              })
          ).map((d) => d.id)
        : []

    const dados = {
        workspaceId,
        email,
        role: lido.data.role,
        canTransfer: lido.data.canTransfer,
        recebeConversas: lido.data.recebeConversas ?? lido.data.role !== 'ADMIN',
        departmentIds: departamentos,
        tokenHash,
        expiresAt: vencimentoDe(agora),
        invitedByUserId: auth.member.userId,
        revokedAt: null,
    }

    const convite = pendente
        ? await prisma.invite.update({ where: { id: pendente.id }, data: dados })
        : await prisma.invite.create({ data: dados })

    /**
     * O e-mail, **fora** da transação e sem `await` que derrube a resposta.
     *
     * Convite gravado e e-mail não enviado tem conserto — é o botão Reenviar.
     * E-mail enviado com convite não gravado não tem: a pessoa recebe um link
     * que não existe. Então grava primeiro, avisa depois.
     */
    const unidade = await prisma.workspace
        .findUnique({ where: { id: workspaceId }, select: { name: true } })
        .catch(() => null)

    /**
     * `APP.url`, e não `NEXT_PUBLIC_APP_URL`.
     *
     * É aqui que o convite antigo quebrava: ele montava
     * `${process.env.NEXT_PUBLIC_APP_URL}/auth/login`, e aquela variável é
     * **deliberadamente não declarada** no Worker (ver `cloudflare.config.ts`:
     * usá-la como `baseURL` do Better Auth derrubaria sessões). Em produção o
     * link saía como `undefined/auth/login` — e `/auth/login` nem é rota, o
     * grupo `(auth)` serve `/login`.
     *
     * `APP.url` tem default por produto no config, então resolve mesmo sem
     * variável de ambiente nenhuma.
     */
    const url = `${APP.url}/convite/${token}`
    void sendEmail({
        to: email,
        subject: `Você foi convidado para o ${BRAND.name}`,
        html: TEMPLATES.inviteMember(url, unidade?.name),
    }).catch((erro) => console.error('[CONVITE] falha ao enviar', erro))

    return NextResponse.json(
        { id: convite.id, email, estado: 'pendente', expiresAt: convite.expiresAt },
        { status: 201 }
    )
}
