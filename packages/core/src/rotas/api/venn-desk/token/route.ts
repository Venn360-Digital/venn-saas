import { NextResponse } from 'next/server'
import type { JWK } from 'jose'

import prisma from '@venn/db/cliente'
import { getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { requireUsuario } from '@venn/core/lib/auth/sessao'
import { criarRotaDeToken } from '@venn/desk-widget/servidor'

/**
 * O token que o widget do Venn Desk usa para falar com a central de suporte.
 *
 * **Uma rota, três apps.** Ela nasce aqui no core pelo mesmo motivo que todas
 * as outras: o conteúdo mora uma vez e cada app carrega uma casca de duas
 * linhas. Três cópias desta assinatura seriam três lugares para errar o `aud`,
 * a validade ou uma claim — e o erro só apareceria quando um app parasse de
 * conseguir abrir chamado.
 *
 * **A chave privada nunca sai daqui.** Ela é segredo do Worker do app; o Venn
 * Desk conhece só a metade pública. Quem assina é o app, e é isso que permite
 * ao Desk confiar na identidade sem nunca ler o banco de ninguém.
 *
 * **O usuário não escolhe quem é.** Tudo o que vai no token sai da sessão e do
 * banco — nada do corpo da requisição. Fosse diferente, o widget seria um jeito
 * de abrir chamado em nome de outra pessoa, ou de outra clínica.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * O app a que este Worker pertence, e a chave com que ele assina.
 *
 * Vêm do ambiente porque são **por app**: o mesmo código roda no Worker do
 * Odontobox, do Conecta e do Stagent, e cada um assina como si mesmo.
 */
function configuracao(): { app: string; chave: JWK } | null {
    const app = process.env['VENN_DESK_APP']
    const bruto = process.env['VENN_DESK_CHAVE_PRIVADA']

    if (!app || !bruto) return null

    try {
        return { app, chave: JSON.parse(bruto) as JWK }
    } catch {
        /// Chave ilegível é erro de configuração, não do usuário — e some em
        /// silêncio se a gente deixar.
        console.error('[venn-desk] VENN_DESK_CHAVE_PRIVADA não é um JWK válido')
        return null
    }
}

/**
 * Quem está pedindo, do ponto de vista do app.
 *
 * O papel é traduzido: `OWNER` e `ADMIN` do workspace viram `admin` para o Venn
 * Desk, que é o que faz a pessoa ver os chamados da empresa inteira e não só os
 * seus. Os demais papéis veem os próprios — o gestor de uma clínica não precisa
 * ler o chamado que a recepcionista abriu sobre o próprio acesso.
 */
async function identidade() {
    const sessao = await getWorkspaceMember()
    if (!sessao.ok) return null

    const usuario = await requireUsuario().catch(() => null)
    if (!usuario) return null

    const unidade = await prisma.workspace.findUnique({
        where: { id: sessao.member.workspaceId },
        select: {
            name: true,
            accountId: true,
            /**
             * O plano mora na ASSINATURA, não na conta.
             *
             * Escrevi `account.plan` de primeira e o schema não tem esse
             * campo — `Account` guarda cobrança e endereço, e o plano
             * contratado é `Subscription.plan`. Ler do lugar errado teria
             * compilado se o Prisma fosse frouxo; não é, e falhou na hora.
             */
            account: {
                select: { name: true, subscription: { select: { plan: true } } },
            },
        },
    })

    const papel = sessao.member.role === 'OWNER' || sessao.member.role === 'ADMIN' ? 'admin' : 'member'

    return {
        usuarioId: usuario.id,
        tenantId: sessao.member.workspaceId,
        ...(unidade?.name ? { tenantNome: unidade.name } : {}),
        ...(unidade?.accountId ? { contaId: unidade.accountId } : {}),
        ...(unidade?.account?.name ? { contaNome: unidade.account.name } : {}),
        ...(unidade?.account?.subscription?.plan
            ? { plano: unidade.account.subscription.plan }
            : {}),
        /// `nome`, não `name`: a sessão do monorepo é em português, como o
        /// resto do domínio. E é opcional — cadastro por e-mail e senha pode
        /// não ter nome —, daí o e-mail como último recurso.
        nome: usuario.nome ?? usuario.email,
        email: usuario.email,
        papel,
    }
}

export async function POST(requisicao: Request): Promise<Response> {
    const config = configuracao()

    if (config === null) {
        /**
         * 503 e não 500: não é falha, é ausência de configuração. O widget lê
         * isso e simplesmente não se desenha — um app sem Venn Desk configurado
         * continua funcionando, sem botão de suporte e sem erro na tela.
         */
        return NextResponse.json(
            { erro: 'Suporte não configurado neste app.' },
            { status: 503 }
        )
    }

    const rota = criarRotaDeToken({
        app: config.app,
        chavePrivada: () => config.chave,
        identidade,
    })

    return rota(requisicao)
}
