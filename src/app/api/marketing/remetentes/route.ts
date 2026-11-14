import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { criarIdentidade, credenciaisDoSes } from '@venn/core/lib/email/ses'
import { registrosDeDns, nomeDoConfigurationSet } from '@venn/core/lib/marketing/remetentes'
import { APP } from '@/config/app.config'

/**
 * Os remetentes de e-mail da unidade — os domínios por onde a campanha sai.
 *
 * Campanha sai do domínio da própria unidade, nunca de um subdomínio nosso: um
 * e-mail vindo de `mkt.venn360.com` com o nome da clínica no remetente tem
 * exatamente a forma de um phishing, e a reputação ficaria compartilhada entre
 * todos os clientes — incluindo o transacional, que leva recuperação de senha.
 *
 * Ver `src/lib/email/ses.ts` para por que o SES e não o Email Sending da
 * Cloudflare.
 */

const criarSchema = z.object({
    /**
     * O domínio. Pode ser o apex (`clinica.com.br`) ou um subdomínio
     * (`mkt.clinica.com.br`) — o SES trata cada um como identidade própria, e
     * subdomínio separa a reputação de marketing da do e-mail que a equipe usa
     * no dia a dia.
     */
    domain: z
        .string()
        .trim()
        .toLowerCase()
        // Sem protocolo, sem caminho, sem arroba: é domínio, não endereço nem URL.
        // A mensagem diz o formato porque "inválido" sozinho não ensina nada.
        .regex(
            /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
            'Informe só o domínio, como clinica.com.br — sem https:// e sem @'
        ),
    /** A parte antes do @. Junto com o domínio forma o endereço do remetente. */
    fromLocal: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9._-]{1,64}$/, 'Use só letras, números, ponto, hífen ou sublinhado')
        .default('contato'),
    fromName: z.string().trim().min(1, 'Informe o nome que aparece para quem recebe'),
    /**
     * Obrigatório na prática: campanha gera resposta, e não existe canal de
     * e-mail no inbox. Sem isto a resposta do contato morre numa caixa que
     * ninguém lê.
     */
    replyTo: z.string().trim().toLowerCase().email('Informe um e-mail válido para resposta'),
})

export async function GET() {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const remetentes = await prisma.emailSender.findMany({
        where: { workspaceId: member.workspaceId },
        orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(
        remetentes.map((r) => ({
            id: r.id,
            domain: r.domain,
            from: `${r.fromLocal}@${r.domain}`,
            fromLocal: r.fromLocal,
            fromName: r.fromName,
            replyTo: r.replyTo,
            status: r.status,
            dkimStatus: r.dkimStatus,
            verifiedAt: r.verifiedAt,
            lastCheckedAt: r.lastCheckedAt,
            /**
             * Os registros que o cliente publica na zona dele. Montados aqui, e
             * não guardados, porque são função dos tokens — guardá-los seria uma
             * segunda cópia para divergir.
             */
            dns: registrosDeDns(r.domain, r.dkimTokens),
            createdAt: r.createdAt,
        }))
    )
}

/**
 * Cadastra um domínio e pede a identidade ao SES.
 *
 * O remetente nasce `pending` e **só vira `verified` quando o SES confirma o
 * DKIM** — é o cron `ses-verificar-remetente` que pergunta. Campanha não sai de
 * remetente não verificado: é o mesmo portão que o WhatsApp tem com o template
 * aprovado, e pela mesma razão — disparar sem autenticação queima o domínio do
 * cliente de uma vez.
 */
export async function POST(request: NextRequest) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const corpo = criarSchema.safeParse(await request.json())
    if (!corpo.success) {
        /**
         * O erro volta com o **campo** que o causou.
         *
         * O DESIGN.md manda o erro aparecer abaixo do campo, nunca em toast nem
         * em resumo no topo — e para a tela conseguir isso, o servidor tem de
         * dizer de qual campo se trata.
         */
        const primeiro = corpo.error.issues[0]
        return NextResponse.json(
            { error: primeiro.message, campo: primeiro.path[0] ?? null },
            { status: 400 }
        )
    }

    const { domain, fromLocal, fromName, replyTo } = corpo.data

    if (!credenciaisDoSes()) {
        // 503 e não 500: não é defeito, é a feature não estar ligada neste app.
        return NextResponse.json(
            { error: 'O envio de e-mail de campanha ainda não está configurado nesta instalação' },
            { status: 503 }
        )
    }

    const jaExiste = await prisma.emailSender.findUnique({
        where: { workspaceId_domain: { workspaceId: member.workspaceId, domain } },
        select: { id: true },
    })
    if (jaExiste) {
        return NextResponse.json(
            { error: 'Este domínio já está cadastrado', campo: 'domain' },
            { status: 409 }
        )
    }

    /**
     * O configuration set é **do app**, não da unidade — ele já existe, criado
     * uma vez junto com as credenciais.
     *
     * É por ele que os eventos (entrega, abertura, clique, reclamação) voltam.
     * De quem é cada evento vem das `EmailTags` do envio, que carregam o id da
     * campanha e o do destinatário; um por unidade seria um objeto a criar por
     * cliente para dizer o que a tag já diz — e criá-lo na hora exigiria
     * permissão de configuração de conta no caminho de uma requisição.
     */
    const configurationSetName = nomeDoConfigurationSet(APP.slug)

    const resultado = await criarIdentidade(domain, configurationSetName)
    if (!resultado.ok) {
        return NextResponse.json(
            { error: `O provedor de e-mail recusou o domínio: ${resultado.error}` },
            { status: 502 }
        )
    }

    const { identidade } = resultado

    const criado = await prisma.emailSender.create({
        data: {
            workspaceId: member.workspaceId,
            domain,
            fromLocal,
            fromName,
            replyTo,
            dkimTokens: identidade.tokens,
            dkimStatus: identidade.dkimStatus,
            configurationSetName,
            // Um domínio já verificado antes (outra unidade da mesma conta, ou
            // recadastro) volta pronto, e segurá-lo em `pending` até o cron
            // rodar faria a tela mentir.
            status: identidade.prontaParaEnvio ? 'verified' : 'pending',
            verifiedAt: identidade.prontaParaEnvio ? new Date() : null,
            lastCheckedAt: new Date(),
        },
    })

    return NextResponse.json(
        {
            id: criado.id,
            domain: criado.domain,
            from: `${criado.fromLocal}@${criado.domain}`,
            status: criado.status,
            dns: registrosDeDns(criado.domain, criado.dkimTokens),
        },
        { status: 201 }
    )
}
