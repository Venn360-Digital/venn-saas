import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { getPlatformAdmin } from '@venn/core/lib/platform-credentials'

/**
 * Os parâmetros que a conta da Venn360 pode mexer na conta de um cliente.
 *
 * ## O que entra aqui, e o critério
 *
 * Ele pediu que a super conta "consiga alterar parâmetros do sistema". Entram
 * os que o suporte de fato precisa e que não têm caminho pela tela do cliente:
 *
 * - **estender a avaliação** — o caso mais comum de todos: o cliente sumiu três
 *   dias por causa de uma viagem e pede mais uma semana;
 * - **dar crédito** — quando a conta queimou crédito por defeito nosso, ou numa
 *   negociação;
 * - **tirar o somente-leitura** — destravar quem pagou e o webhook não chegou,
 *   sem esperar o Asaas reprocessar.
 *
 * ## E o que NÃO entra
 *
 * **Segredo nenhum.** Chave de API, token de webhook e credencial de
 * integração não passam por formulário de navegador — a decisão é de
 * 2026-10-24 e está escrita em `lib/platform-credentials.ts`. A primeira metade
 * do Asaas é a chave que movimenta cobrança; nenhum SaaS põe isso atrás de uma
 * sessão. Elas entram por `wrangler secret put`.
 *
 * **Plano, não.** Trocar o plano por aqui desencontraria a assinatura do Asaas
 * do que o banco diz — e o que cobra é o Asaas. Quem muda plano é o fluxo de
 * cobrança, que fala com os dois lados.
 *
 * Cada ajuste é gravado no registro de acesso da plataforma, com o motivo.
 */

type Ajuste =
    | { tipo: 'avaliacao'; dias: number }
    | { tipo: 'creditos'; quantidade: number }
    | { tipo: 'destravar' }

export async function PATCH(request: NextRequest) {
    const admin = await getPlatformAdmin()
    if (!admin) {
        return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
    }

    const corpo = (await request.json().catch(() => null)) as {
        accountId?: unknown
        ajuste?: unknown
        motivo?: unknown
    } | null

    const accountId = typeof corpo?.accountId === 'string' ? corpo.accountId : ''
    const ajuste = corpo?.ajuste as Ajuste | undefined
    const motivo = typeof corpo?.motivo === 'string' ? corpo.motivo.trim() : ''

    if (!accountId || !ajuste?.tipo) {
        return NextResponse.json({ error: 'Informe a conta e o ajuste' }, { status: 400 })
    }

    /**
     * O motivo é **obrigatório** aqui, ao contrário do acesso.
     *
     * Entrar para olhar é rotina; mexer no plano de alguém é exceção, e exceção
     * sem motivo escrito é a linha que ninguém consegue explicar seis meses
     * depois. É pouco atrito para o que evita.
     */
    if (motivo.length < 4) {
        return NextResponse.json({ error: 'Escreva o motivo do ajuste' }, { status: 400 })
    }

    const assinatura = await prisma.subscription.findUnique({
        where: { accountId },
        select: { id: true, trialEndsAt: true, credits: true, readOnlySince: true },
    })
    if (!assinatura) {
        return NextResponse.json({ error: 'Conta sem assinatura' }, { status: 404 })
    }

    let descricao: string

    if (ajuste.tipo === 'avaliacao') {
        const dias = Math.min(Math.max(Math.trunc(Number(ajuste.dias) || 0), 1), 30)
        /**
         * A partir de HOJE quando a avaliação já venceu, e a partir do fim
         * quando ainda corre.
         *
         * Somar sempre ao fim antigo daria "mais sete dias" que já passaram: a
         * conta cujo prazo venceu há duas semanas continuaria vencida depois do
         * ajuste, e o operador acharia que o botão não funciona.
         */
        const base =
            assinatura.trialEndsAt && assinatura.trialEndsAt > new Date()
                ? assinatura.trialEndsAt
                : new Date()
        const novo = new Date(base.getTime() + dias * 24 * 60 * 60_000)

        await prisma.subscription.update({
            where: { id: assinatura.id },
            data: { trialEndsAt: novo, status: 'trialing', readOnlySince: null },
        })
        descricao = `avaliação estendida em ${dias} dia(s), até ${novo.toISOString()}`
    } else if (ajuste.tipo === 'creditos') {
        const quantidade = Math.min(Math.max(Math.trunc(Number(ajuste.quantidade) || 0), 1), 100_000)
        await prisma.subscription.update({
            where: { id: assinatura.id },
            data: { credits: { increment: quantidade } },
        })
        descricao = `${quantidade} crédito(s) concedido(s)`
    } else {
        await prisma.subscription.update({
            where: { id: assinatura.id },
            data: { readOnlySince: null, graceEndsAt: null, pastDueSince: null, status: 'active' },
        })
        descricao = 'somente-leitura removido'
    }

    /**
     * O ajuste vira uma linha do mesmo registro do acesso, já fechada.
     *
     * Mesma tabela e não uma segunda: a pergunta que alguém vai fazer é "o que
     * a Venn360 fez nesta conta", e ela não se responde com duas listas para
     * cruzar à mão.
     */
    const unidade = await prisma.workspace.findFirst({
        where: { accountId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
    })

    await prisma.platformAccessLog.create({
        data: {
            userId: admin.userId,
            accountId,
            workspaceId: unidade?.id ?? '',
            modo: 'ajuste',
            motivo: `${descricao} — ${motivo}`,
            endedAt: new Date(),
        },
    })

    return NextResponse.json({ ok: true, descricao })
}
