import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import {
    apresentarCampanha,
    CANAIS_DE_CAMPANHA,
    INCLUDE_DA_APRESENTACAO,
} from '@venn/core/lib/marketing/apresentacao'

const createSchema = z.object({
    name: z.string().min(1),
    labels: z.array(z.string()).optional(),
    /**
     * O canal da campanha. Padrao `whatsapp` — preserva o cliente da API que
     * nao manda o campo, e era o unico canal quando a rota nasceu.
     *
     * Os campos obrigatorios **mudam com ele**, e o banco nao sabe expressar
     * "obrigatorio quando channel = 'whatsapp'". Por isso o schema aceita os
     * dois conjuntos como opcionais e a validacao por canal acontece abaixo,
     * onde da para dizer qual campo faltou.
     */
    channel: z.enum(CANAIS_DE_CAMPANHA).default('whatsapp'),

    // WhatsApp
    integrationId: z.string().min(1).optional(),
    templateId: z.string().min(1).optional(),
    variables: z.record(z.string(), z.unknown()).optional(),

    // E-mail
    senderId: z.string().min(1).optional(),
    emailTemplateId: z.string().min(1).optional(),
    subject: z.string().trim().max(200).optional(),
    preheader: z.string().trim().max(200).optional(),

    listIds: z.array(z.string()).min(1),
    throttlePerMin: z.number().int().positive().max(600).optional(),
})

// GET — lista as campanhas, opcionalmente por status (?status=draft|scheduled|...).
export async function GET(request: NextRequest) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const status = request.nextUrl.searchParams.get('status')
    const campanhas = await prisma.broadcast.findMany({
        where: {
            workspaceId: member.workspaceId,
            ...(status ? { status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: INCLUDE_DA_APRESENTACAO,
    })

    return NextResponse.json(
        campanhas.map((b) => ({
            id: b.id,
            name: b.name,
            labels: b.labels,
            status: b.status,
            scheduledAt: b.scheduledAt,
            ...apresentarCampanha(b),
            totalCount: b.totalCount,
            sentCount: b.sentCount,
            failedCount: b.failedCount,
            createdAt: b.createdAt,
        }))
    )
}

// POST — cria uma campanha em rascunho. Valida que a linha é oficial e que o
// template é aprovado e desta conta.
export async function POST(request: NextRequest) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    let data: z.infer<typeof createSchema>
    try {
        data = createSchema.parse(await request.json())
    } catch (e) {
        if (e instanceof z.ZodError) return NextResponse.json({ errors: e.issues }, { status: 400 })
        throw e
    }

    /**
     * A validacao por canal.
     *
     * Cada ramo confere **posse e estado** do que foi escolhido: a linha e
     * deste workspace e e oficial; o remetente e deste workspace e esta
     * verificado. Conferir so o id deixaria passar o id de outra unidade —
     * esconder da tela nao e autorizacao.
     */
    if (data.channel === 'email') {
        const erro = await validarEmail(member.workspaceId, data)
        if (erro) return erro
    } else {
        const erro = await validarWhatsApp(member.workspaceId, data)
        if (erro) return erro
    }

    // As listas têm de ser do workspace.
    const listas = await prisma.contactList.findMany({
        where: { id: { in: data.listIds }, workspaceId: member.workspaceId },
        select: { id: true },
    })
    if (listas.length === 0) {
        return NextResponse.json({ error: 'Nenhuma lista válida informada.' }, { status: 400 })
    }

    const broadcast = await prisma.broadcast.create({
        data: {
            workspaceId: member.workspaceId,
            name: data.name,
            labels: data.labels ?? [],
            channel: data.channel,
            integrationId: data.channel === 'email' ? null : data.integrationId,
            templateId: data.channel === 'email' ? null : data.templateId,
            variables: data.channel === 'email' ? undefined : ((data.variables as object) ?? undefined),
            senderId: data.channel === 'email' ? data.senderId : null,
            emailTemplateId: data.channel === 'email' ? data.emailTemplateId : null,
            subject: data.channel === 'email' ? (data.subject ?? null) : null,
            preheader: data.channel === 'email' ? (data.preheader ?? null) : null,
            throttlePerMin: data.throttlePerMin ?? 30,
            status: 'draft',
            lists: { create: listas.map((l) => ({ listId: l.id })) },
        },
    })

    return NextResponse.json({ id: broadcast.id }, { status: 201 })
}

// ─────────────────────────── Validação por canal ───────────────────────────

/** O que as duas validações precisam ler do corpo já parseado. */
type CorpoDeCriacao = z.infer<typeof createSchema>

/** Um 400 com a mensagem no formato que a tela espera — erro abaixo do campo. */
function recusar(error: string, campo?: string): NextResponse {
    return NextResponse.json({ error, campo: campo ?? null }, { status: 400 })
}

/**
 * Campanha de WhatsApp: linha oficial conectada + template aprovado da mesma
 * linha.
 *
 * O QR não dispara broadcast — disparo em massa por QR bane a linha do cliente,
 * e a recusa acontece aqui e não só na tela: esconder a opção não é impedir.
 */
async function validarWhatsApp(
    workspaceId: string,
    data: CorpoDeCriacao
): Promise<NextResponse | null> {
    if (!data.integrationId) return recusar('Escolha a linha de envio.', 'integrationId')
    if (!data.templateId) return recusar('Escolha o template aprovado.', 'templateId')

    const linha = await prisma.agentIntegration.findFirst({
        where: {
            id: data.integrationId,
            channel: 'whatsapp_business',
            agent: { workspaceId },
        },
        select: { id: true },
    })
    if (!linha) {
        return recusar('A linha escolhida não é um WhatsApp oficial conectado.', 'integrationId')
    }

    const template = await prisma.whatsAppTemplate.findFirst({
        where: { id: data.templateId, workspaceId, integrationId: data.integrationId },
        select: { status: true },
    })
    if (!template) return recusar('Template não encontrado para esta linha.', 'templateId')
    if (template.status !== 'APPROVED') {
        return recusar('O template escolhido ainda não está aprovado pela Meta.', 'templateId')
    }

    return null
}

/**
 * Campanha de e-mail: remetente **verificado** + modelo + assunto.
 *
 * O remetente verificado é o portão equivalente ao template aprovado do
 * WhatsApp, e pela mesma razão: disparar por um domínio cujo DKIM não foi
 * confirmado queima a reputação do cliente de uma vez. E o SES recusaria de
 * todo jeito — mas recusaria no meio do fan-out, com metade da campanha já
 * marcada como falha e sem dizer à clínica o que ela precisa fazer.
 *
 * O assunto é exigido aqui, e não no banco, porque ele pode vir do modelo: a
 * campanha só precisa de um **se o modelo não tiver**.
 */
async function validarEmail(
    workspaceId: string,
    data: CorpoDeCriacao
): Promise<NextResponse | null> {
    if (!data.senderId) return recusar('Escolha o remetente.', 'senderId')
    if (!data.emailTemplateId) return recusar('Escolha o modelo de e-mail.', 'emailTemplateId')

    const remetente = await prisma.emailSender.findFirst({
        where: { id: data.senderId, workspaceId },
        select: { status: true, domain: true },
    })
    if (!remetente) return recusar('Remetente não encontrado.', 'senderId')
    if (remetente.status !== 'verified') {
        return recusar(
            `O domínio ${remetente.domain} ainda não foi verificado. Publique os três registros de DNS antes de disparar.`,
            'senderId'
        )
    }

    const modelo = await prisma.emailTemplate.findFirst({
        where: { id: data.emailTemplateId, workspaceId },
        select: { subject: true },
    })
    if (!modelo) return recusar('Modelo de e-mail não encontrado.', 'emailTemplateId')

    if (!data.subject?.trim() && !modelo.subject?.trim()) {
        return recusar('Informe o assunto — o modelo escolhido não tem um.', 'subject')
    }

    return null
}
