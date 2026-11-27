import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { accountIdOf, assinaturaDaUnidade, unidadesDaConta } from '@venn/core/lib/account'
import { currentMembership } from '@venn/core/lib/auth/workspace'
import { usuarioDaSessao } from '@venn/core/lib/auth/sessao'
import { getBillingState } from '@venn/core/lib/billing'
import { cobrancaCompleta } from '@venn/core/lib/billing/dados-de-cobranca'
import { criarCheckoutDePlano } from '@venn/core/lib/asaas/checkout'
import { asaasConfig } from '@venn/core/lib/asaas/client'
import { regimeDaConta } from '@venn/core/lib/asaas/cobranca'
import { cicloDe, isPlanId } from '@venn/core/lib/plan-limits'

/**
 * "Assinar agora" → a página do cartão, em um clique.
 *
 * ## O que esta rota existe para encurtar
 *
 * A faixa de avaliação apontava para `/gerenciamento/conta?tab=plano`, e dali
 * ainda faltavam: achar "Contratar plano" no rodapé do cartão, abrir o diálogo,
 * reconhecer o plano certo entre três e clicar nele. Quatro gestos depois de um
 * botão que prometia assinar — e, até o conserto no `PlanoTab`, o quarto estava
 * desabilitado. A Implante Ja ficou vinte e quatro dias de avaliação sem
 * conseguir pagar, com **zero** checkout criado: ninguém nunca chegou à página
 * do Asaas.
 *
 * O plano e o ciclo já foram escolhidos no cadastro e estão gravados na
 * assinatura desde o primeiro dia. Então não há pergunta a fazer: esta rota lê
 * os dois, cria o checkout recorrente e manda a pessoa para a página segura do
 * Asaas — que mostra o nome do plano, o valor e o formulário do cartão, que é
 * exatamente a tela que o botão promete.
 *
 * ## Por que POST de formulário, e não `fetch` com `window.open`
 *
 * A faixa é componente de **servidor** e está presente em toda tela do painel.
 * O `PlanoTab` abre o pagamento em janela própria, e para isso precisa de um
 * `window.open` **dentro** do gesto do usuário — o que obriga a abrir a janela
 * vazia antes de saber o endereço. Replicar aquilo na faixa exigiria torná-la
 * cliente e carregar essa dança em toda página do sistema.
 *
 * Um `<form method="post">` com redirecionamento de página inteira não tem nada
 * disso: é HTTP, não depende de pop-up, e a volta do Asaas já sabe se comportar
 * sem janela de origem (ver `pagamento/retorno`). Mais pobre visualmente que a
 * janelinha, e imune a tudo.
 *
 * E **POST**, não GET: criar checkout é efeito colateral, e um GET aqui seria
 * disparado pelo prefetch do `<Link>` do Next ao simples passar o mouse — uma
 * cobrança aberta no Asaas por hover.
 *
 * ## O que ela NÃO faz
 *
 * Não cobra diferença proporcional, não troca ciclo, não desce de plano. Ela
 * serve **à primeira contratação**, que é o único caso em que não há nada a
 * perguntar. Qualquer outra situação volta para a guia com o diálogo aberto
 * (`?assinar=1`), onde a escolha existe. Quem ativa o plano continua sendo o
 * webhook, quando o dinheiro entra.
 *
 * ## Vale para os três apps, e sobrevive a ficar sem gateway
 *
 * Mora no core, então o gerador de rotas a espelha em odontobox360,
 * conecta360 e stagent360 — e a faixa que a chama é a mesma nos três, pelo
 * layout do painel. Não há nada de um app aqui.
 *
 * Do gateway, há: a chamada final é a do Asaas. A chave dele é da plataforma e
 * cada ambiente guarda a sua — **homologação a de sandbox (`$aact_hmlg_`),
 * produção a de produção (`$aact_prod_`)** —, então este caminho se exercita em
 * homologação de ponta a ponta, com cobrança de sandbox. O Stripe é decisão
 * tomada em 27/11/2026 para um gateway futuro, e ainda não existe em ambiente
 * nenhum; o ponto onde ele entra está marcado no corpo.
 */

/** A guia, com o diálogo de planos já aberto. O destino de todo desvio. */
function paraAGuia(request: NextRequest, erro?: 'checkout'): NextResponse {
    const url = new URL('/gerenciamento/conta', request.url)
    url.searchParams.set('tab', 'plano')
    url.searchParams.set('assinar', '1')
    if (erro) url.searchParams.set('erro', erro)
    /**
     * 303 e não 302: manda o navegador trocar o POST por um GET.
     *
     * Com 302 ele repetiria o método no destino, e a guia — que é uma página —
     * responderia 405 a um POST.
     */
    return NextResponse.redirect(url, 303)
}

/**
 * O endereço desta aplicação, para o Asaas devolver o pagador.
 *
 * Do cabeçalho e não de `NEXT_PUBLIC_APP_URL`, pela mesma razão que está
 * escrita em `api/account/subscription`: a variável é assada no build, e um
 * deploy com ela errada devolveria o pagador ao domínio anterior.
 */
function baseDaAplicacao(request: NextRequest): string {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https'
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    return host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_APP_URL ?? '')
}

export async function POST(request: NextRequest) {
    /**
     * Mesma origem, conferida à mão.
     *
     * Um `<form>` de outro site pode postar aqui levando o cookie de sessão, e
     * o estrago seria um checkout aberto no Asaas sem ninguém ter pedido — não
     * cobra nada, mas aparece no painel financeiro e polui o extrato. O
     * `Sec-Fetch-Site` resolve nos navegadores atuais; o `Origin` atende quem
     * não o manda.
     */
    const site = request.headers.get('sec-fetch-site')
    if (site && site !== 'same-origin') {
        return NextResponse.json({ error: 'Origem inválida' }, { status: 403 })
    }
    const origem = request.headers.get('origin')
    if (origem && new URL(origem).host !== new URL(request.url).host) {
        return NextResponse.json({ error: 'Origem inválida' }, { status: 403 })
    }

    const usuario = await usuarioDaSessao()
    const membro = await currentMembership()
    /**
     * Quem paga é quem administra — o mesmo recorte de
     * `POST /api/account/subscription`.
     *
     * Um ATENDENTE que clicasse na faixa não deve abrir cobrança para a
     * clínica. Ele volta para a guia, onde a tela explica.
     */
    if (!membro || !['OWNER', 'ADMIN'].includes(membro.role)) {
        return paraAGuia(request)
    }

    const assinatura = await prisma.subscription.findFirst({
        where: assinaturaDaUnidade(membro.workspaceId),
        select: { plan: true, billingCycle: true },
    })

    const estado = await getBillingState(membro.workspaceId)

    /**
     * Três desvios, e os três levam ao mesmo lugar com o diálogo aberto.
     *
     * - **plano já contratado** (`fase === 'active'`): não há primeira
     *   contratação a fazer. Inclui a conta em atraso, cujo caminho é a fatura
     *   vencida, e a cancelada com período correndo, cujo caminho é desfazer o
     *   cancelamento — criar checkout novo ali geraria uma **segunda**
     *   assinatura no Asaas.
     * - **sem plano** (`none`): não há o que assinar sem escolher antes.
     * - **plano inválido**: coluna com valor que saiu da tabela.
     */
    if (estado.phase === 'active' || !assinatura || !isPlanId(assinatura.plan)) {
        return paraAGuia(request)
    }

    const accountId = await accountIdOf(membro.workspaceId)
    if (!accountId) return paraAGuia(request)

    /**
     * Conta isenta ou antes da data de cobrança não vai ao gateway.
     *
     * Ela ativa direto, e quem sabe fazer isso — com a mensagem que explica por
     * que nada foi cobrado — é a rota de assinatura. Mandar essa conta para uma
     * página de cartão seria cobrar quem o Andre decidiu não cobrar.
     */
    const regime = await regimeDaConta(accountId)
    if (!regime.precisaPagar) return paraAGuia(request)

    /**
     * SEM GATEWAY CONFIGURADO, o atalho cai na guia em vez de quebrar.
     *
     * A chave do Asaas é da **plataforma**, guardada no cofre, e cada ambiente
     * guarda a sua: homologação a de sandbox, produção a de produção — o prefixo
     * é que carrega o ambiente (ver `asaas/client.ts`). Nos dois há chave, então
     * em operação normal esta pergunta passa; ela existe para o ambiente novo, o
     * cofre vazio e a chave revogada, onde `asaasConfig()` devolve `null` e toda
     * chamada morre com `AsaasError(0, 'Asaas não configurado')`.
     *
     * Conferir aqui, antes, e não só no `catch`: `criarCheckoutDePlano` **grava
     * a linha de tentativa primeiro** e só então chama o gateway — de propósito,
     * para nunca haver checkout pago sem dono. Sem chave, cada clique no botão
     * deixaria uma tentativa `CANCELED` no banco. Uma pergunta barata evita uma
     * tabela de lixo.
     *
     * **E é aqui que o Stripe entra**, quando entrar: esta pergunta passa a ser
     * "qual gateway esta conta usa, e ele está configurado?", e a chamada abaixo
     * passa a ser a daquele gateway. O resto desta rota — quem pode, qual plano,
     * qual ciclo, para onde desviar — não muda, porque nada disso é do Asaas.
     */
    if (!(await asaasConfig())) {
        console.warn(
            `[ASSINAR] conta ${accountId}: sem gateway configurado neste ambiente; ` +
                'o atalho cai na guia de assinatura.'
        )
        return paraAGuia(request)
    }

    const conta = await prisma.account.findUnique({
        where: { id: accountId },
        select: {
            name: true,
            cpfCnpj: true,
            postalCode: true,
            address: true,
            addressNumber: true,
            province: true,
            city: true,
            state: true,
            billingPhone: true,
            asaasCustomerId: true,
        },
    })
    if (!conta) return paraAGuia(request)

    /**
     * Sem o conjunto completo de cobrança, a guia pergunta — aqui, não.
     *
     * `criarCheckoutDePlano` recusaria o `customerData` pela metade (a tabela
     * está lá), e o servidor de assinatura já exige o conjunto antes de abrir
     * pagamento. O formulário que falta mora no diálogo, em cima da guia, e
     * retoma a contratação ao gravar.
     */
    const pagador = cobrancaCompleta(conta)
    if (!pagador) return paraAGuia(request)

    const unidades = await unidadesDaConta(accountId)

    try {
        const { link } = await criarCheckoutDePlano({
            accountId,
            plan: assinatura.plan,
            ciclo: cicloDe(assinatura.billingCycle),
            adicionais: unidades.cobraveis,
            /**
             * O mesmo pagador que a rota de assinatura monta, campo por campo.
             *
             * `name` é o da conta e `email` o de quem está contratando — o
             * Asaas pede um contato, e `accounts` não guarda e-mail próprio.
             * O resto é o endereço de cobrança da conta, nunca digitado aqui.
             */
            pagador: {
                name: conta.name,
                email: usuario?.email ?? '',
                cpfCnpj: pagador.cpfCnpj,
                phone: pagador.billingPhone,
                address: pagador.address,
                addressNumber: pagador.addressNumber,
                province: pagador.province,
                postalCode: pagador.postalCode,
            },
            asaasCustomerId: conta.asaasCustomerId,
            baseUrl: baseDaAplicacao(request),
        })

        return NextResponse.redirect(link, 303)
    } catch (erro) {
        console.error(`[ASSINAR] conta ${accountId}: o gateway recusou o checkout. ${String(erro)}`)
        return paraAGuia(request, 'checkout')
    }
}
