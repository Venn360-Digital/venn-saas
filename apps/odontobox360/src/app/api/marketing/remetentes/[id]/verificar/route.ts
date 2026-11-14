import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { conferirRemetente } from '@venn/core/lib/marketing/conferir-remetente'
import { explicacaoDoDkim, registrosDeDns } from '@venn/core/lib/marketing/remetentes'

/**
 * "Verificar agora" — pergunta ao SES na hora.
 *
 * ## Por que isto existe, se já há um cron
 *
 * A rotina `ses-verificar-remetente` pergunta de hora em hora, e é ela que
 * garante que ninguém fica pendente para sempre. Mas o momento que importa para
 * quem está configurando é **outro**: a pessoa acabou de colar os três CNAME na
 * zona e quer saber se acertou. Esperar até uma hora, sem nada para apertar, é a
 * hora em que ela abre um chamado perguntando se o sistema está travado.
 *
 * ## Não aplica a regra de desistência
 *
 * O cron marca `failed` depois de uma semana para parar de perguntar por domínio
 * abandonado. Aqui `venceu` é sempre `false`: quem clica está mexendo no DNS
 * naquele instante, e recusar o domínio porque passaram sete dias seria hostil
 * exatamente na hora em que ela está consertando.
 *
 * ## Devolve os registros de novo
 *
 * O SES pode ter recriado a identidade do outro lado, e aí os tokens mudam.
 * `conferirRemetente` grava os novos; esta rota devolve os três CNAME atuais para
 * a ficha se atualizar sem recarregar — senão a pessoa ficaria conferindo
 * registros velhos contra um erro que já mudou de causa.
 */
export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const remetente = await prisma.emailSender.findFirst({
        where: { id, workspaceId: member.workspaceId },
        select: { id: true, domain: true },
    })
    if (!remetente) return new NextResponse('Domínio não encontrado', { status: 404 })

    const desfecho = await conferirRemetente(remetente)

    if (!desfecho.ok) {
        /**
         * 503 e não 400: a falha é **nossa** ou da AWS, não do que a pessoa
         * fez. 400 faria a tela sugerir que ela corrigisse algo, e não há nada
         * para corrigir — o estado do domínio não mudou.
         */
        return NextResponse.json(
            { error: `Não foi possível perguntar ao SES agora: ${desfecho.error}` },
            { status: 503 }
        )
    }

    const atual = await prisma.emailSender.findUnique({
        where: { id },
        select: { dkimTokens: true, verifiedAt: true, lastCheckedAt: true },
    })

    return NextResponse.json({
        status: desfecho.status,
        dkimStatus: desfecho.dkimStatus,
        explicacao: explicacaoDoDkim(desfecho.dkimStatus),
        dns: registrosDeDns(remetente.domain, atual?.dkimTokens ?? []),
        verifiedAt: atual?.verifiedAt?.toISOString() ?? null,
        lastCheckedAt: atual?.lastCheckedAt?.toISOString() ?? null,
    })
}
