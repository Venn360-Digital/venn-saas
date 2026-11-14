import prisma from '@venn/db/cliente'
import { asaas } from './client'
import { PLANS, type PlanId } from '../plans'
import { UNIDADE_ADICIONAL } from '../plans'
import { CICLOS, TREINAMENTO, valorDaFatura, type BillingCycle } from '../plan-limits'

/**
 * O checkout hospedado do Asaas: a página onde o cliente paga.
 *
 * Nós não desenhamos tela de pagamento e não tocamos no número do cartão. O
 * pagador vai para uma página do Asaas, paga, e volta. A
 * alternativa — tokenizar o cartão no nosso servidor — levaria o PAN pelo nosso
 * código e pelos nossos logs, e o escopo de PCI sairia de SAQ A para SAQ A-EP.
 * Ver PRODUCT.md §13.
 *
 * **Criar o checkout não é confirmação financeira**, e a documentação deles diz
 * isso em letra. Quem ativa o plano é o webhook; a volta do pagador para a nossa
 * tela é navegação, não prova — o navegador pode fechar, perder a rede ou ser
 * adulterado.
 */

/** Quanto o plano custa por mês, somadas as unidades adicionais já contratadas. */
export function mensalidadeDoPlano(plan: PlanId, adicionais: number): number {
    return PLANS[plan].price + adicionais * UNIDADE_ADICIONAL.price
}

/**
 * Os meios aceitos numa cobrança **avulsa**: Pix e cartão.
 *
 * **Boleto não existe no Checkout**, e isso é medido, não suposto. Ele entrou
 * aqui em 2026-10-19 a pedido do Andre e quebrou a compra de crédito com "O
 * campo billingTypes é inválido". As tentativas, contra o sandbox:
 *
 * | billingTypes | resposta |
 * |---|---|
 * | `['PIX','CREDIT_CARD']` | checkout criado |
 * | `['PIX','CREDIT_CARD','BOLETO']` | `invalid_object` |
 * | `['BOLETO']` | `invalid_object` |
 * | `['PIX','CREDIT_CARD','BANK_SLIP']` | `parse_error` — valor desconhecido |
 *
 * O `parse_error` do último é o que fecha a conclusão: `BOLETO` **é** um valor
 * conhecido do enum (passou do parser) e mesmo assim é recusado pelo Checkout.
 * Não é nome errado; é meio não suportado nesse endpoint.
 *
 * Boleto por aqui, se for desejado, precisa de outro caminho: criar a cobrança
 * direto (`POST /v3/payments` com `billingType: BOLETO`) e mandar o pagador
 * para o `bankSlipUrl` — com a entrega presa ao `externalReference` do
 * pagamento em vez do checkout.
 *
 * A **recorrência** continua sendo cartão e só cartão, que também é limite do
 * Asaas: cobrar sozinho todo mês exige credencial guardada.
 */
const AVULSO = ['PIX', 'CREDIT_CARD'] as const

interface RespostaCheckout {
    id: string
    link: string
    status?: string
}

export interface DadosDoPagador {
    name: string
    cpfCnpj: string
    email: string
    phone?: string | null
    /** Endereço de cobrança. O cartão exige os cinco; o checkout, nenhum. */
    address?: string | null
    addressNumber?: string | null
    province?: string | null
    postalCode?: string | null
}

/**
 * `customerData` é **tudo ou nada**, e por isso pode ser nada.
 *
 * Medido contra o sandbox em 2026-10-18, com três tentativas:
 *
 * | o que foi mandado | resposta |
 * |---|---|
 * | sem `customerData` | **aceito** — a página do Asaas pergunta ao pagador |
 * | nome + documento + e-mail | **recusado**: faltam phoneNumber, address, addressNumber, postalCode, province |
 * | tudo, com endereço | aceito |
 *
 * Então: se temos o conjunto inteiro, mandamos — o cliente não redigita o que
 * já nos deu, e o documento que vai para o Asaas é o **da conta**, não um que
 * alguém digitou na hora e que divergiria do ERP. Se falta qualquer peça,
 * omitimos e a página deles pergunta. Mandar metade é o único caminho que não
 * funciona.
 */
function dadosCompletos(p: DadosDoPagador): Record<string, string> | null {
    const campos = {
        name: p.name,
        cpfCnpj: p.cpfCnpj,
        email: p.email,
        phone: p.phone ?? '',
        address: p.address ?? '',
        addressNumber: p.addressNumber ?? '',
        province: p.province ?? '',
        postalCode: p.postalCode ?? '',
    }
    return Object.values(campos).every((v) => v.trim().length > 0) ? campos : null
}

/**
 * Cria o checkout recorrente de um plano e guarda a tentativa.
 *
 * A ordem é deliberada: **grava a linha primeiro**, com o id que vai no
 * `externalReference`, e só então chama o Asaas. Se a chamada falhar, sobra uma
 * linha sem checkout — visível, descartável, inofensiva. Na ordem inversa
 * sobraria um checkout pago no Asaas que o nosso webhook não saberia a quem
 * atribuir, e isso é dinheiro recebido sem dono.
 *
 * `minutesToExpire` em 60 minutos: checkout que fica aberto o dia todo é
 * cobrança que o cliente esqueceu que começou. Expirado, a tela oferece
 * contratar de novo.
 */
export async function criarCheckoutDePlano(opcoes: {
    accountId: string
    plan: PlanId
    /**
     * Mensal ou anual — o que decide o `value` e o `cycle` da recorrência.
     *
     * Obrigatório, e não com padrão mensal: um padrão aqui transformaria um
     * esquecimento em cobrança errada, e cobrança errada é o defeito mais caro
     * desta integração (ver a assinatura dobrada em `vincular.ts`).
     */
    ciclo: BillingCycle
    adicionais: number
    pagador: DadosDoPagador
    /**
     * O cliente que esta conta já tem no Asaas, quando tem.
     *
     * **Reusar é obrigatório, não otimização.** `customerData` cria um cliente
     * novo a cada checkout, mesmo com o mesmo CNPJ: três pagamentos de teste
     * deixaram três "Venn360" no painel, e num ERP isso vira o mesmo cliente
     * contado três vezes. Com o id em mãos, mandamos `customer` e o Asaas
     * aproveita o que existe.
     */
    asaasCustomerId?: string | null
    /**
     * Cobrança avulsa da diferença, em vez da mensalidade inteira.
     *
     * É o upgrade no meio de um ciclo pago: o cliente já pagou o mês, então o
     * que falta é a diferença dos dias restantes. Sem isto, subir de plano
     * cobraria um segundo mês cheio dentro do período já pago.
     */
    valorProporcional?: number
    /** Para onde o Asaas devolve o pagador. Sem rota, sem volta. */
    baseUrl: string
}): Promise<{ link: string; checkoutId: string }> {
    const {
        accountId,
        plan,
        ciclo,
        adicionais,
        pagador,
        asaasCustomerId,
        valorProporcional,
        baseUrl,
    } = opcoes

    const proporcional = valorProporcional !== undefined
    const valor = proporcional ? valorProporcional : valorDaFatura(plan, adicionais, ciclo)
    const planConfig = PLANS[plan]
    const anual = ciclo === 'annual'

    /**
     * A primeira cobrança é **hoje**.
     *
     * `nextDueDate` é a data da primeira cobrança da assinatura, e o Asaas só
     * cobra no ato quando ela é o dia corrente. Qualquer data futura criaria uma
     * assinatura válida com plano não pago — e o cliente sairia da tela
     * acreditando que contratou.
     */
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

    const tentativa = await prisma.asaasCheckout.create({
        data: {
            accountId,
            plan,
            // Preenchidos depois da resposta: a linha nasce para ter id.
            asaasCheckoutId: `pendente:${accountId}:${Date.now()}`,
            link: '',
            kind: proporcional ? 'proporcional' : 'assinatura',
            /** O webhook não deduz o ciclo do valor pago — ver a coluna. */
            cycle: ciclo,
            valueCents: Math.round(valor * 100),
        },
        select: { id: true },
    })

    try {
        const resposta = await asaas<RespostaCheckout>('/checkouts', {
            method: 'POST',
            body: {
                /**
                 * Recorrente no Checkout é **cartão e só cartão**.
                 *
                 * Mandar `['PIX','CREDIT_CARD']` com `RECURRENT` é recusado em
                 * letra pelo Asaas: "O método de pagamento CREDIT_CARD é o único
                 * método de pagamento permitido para operações RECURRENT; O tipo
                 * de cobrança DETACHED é obrigatório para o método de pagamento
                 * PIX".
                 *
                 * Faz sentido quando se olha o que recorrência significa: cobrar
                 * sozinho todo mês exige credencial guardada, e Pix não tem
                 * isso. "Assinatura no Pix" no Brasil é outra coisa — é fatura
                 * mensal que o cliente paga à mão —, e ela não passa por aqui.
                 */
                /**
                 * Avulso aceita Pix; recorrente, não.
                 *
                 * A diferença de um upgrade é cobrança única, então ela pode ir
                 * por Pix — que confirma em segundos e não exige cartão de quem
                 * só quer subir de plano hoje. A recorrência continua restrita a
                 * cartão, porque cobrar sozinho todo mês exige credencial
                 * guardada (medido: o Asaas recusa PIX com RECURRENT).
                 */
                billingTypes: proporcional ? AVULSO : ['CREDIT_CARD'],
                chargeTypes: proporcional ? ['DETACHED'] : ['RECURRENT'],
                /**
                 * Uma hora, e não um dia.
                 *
                 * Decisão do Andre em 2026-10-20. Checkout aberto por 24h é
                 * cobrança que o cliente esqueceu que começou — e, enquanto
                 * ele vive, a tela anuncia "pagamento em andamento" para uma
                 * página que ninguém vai abrir de novo. Em 60 minutos ou se
                 * paga ou se desiste, e desistir é barato: contratar de novo é
                 * um clique.
                 */
                minutesToExpire: 60,
                /** Como o webhook descobre qual conta e qual plano foram pagos. */
                externalReference: tentativa.id,
                /**
                 * A volta cai numa página de uma frase, não na guia Plano.
                 *
                 * O checkout abre numa janela própria; mandar a volta para a
                 * guia carregaria o sistema inteiro **dentro da janelinha** —
                 * sidebar, cabeçalho e tudo, espremidos em 480 pixels. A página
                 * de retorno avisa a janela de origem e se fecha; se o pop-up
                 * tiver sido bloqueado e isto for a aba principal, ela redireciona
                 * para a guia.
                 */
                callback: {
                    successUrl: `${baseUrl}/pagamento/retorno?status=processando`,
                    cancelUrl: `${baseUrl}/pagamento/retorno?status=cancelado`,
                    expiredUrl: `${baseUrl}/pagamento/retorno?status=expirado`,
                },
                items: [
                    {
                        name: anual ? `${planConfig.name} — 12 meses` : planConfig.name,
                        /**
                         * A linha da fatura diz o ciclo, não só o plano.
                         *
                         * Quem abre o extrato do cartão da clínica e vê
                         * "R$ 9.612,00 · Plano Multiclínica" sem a palavra
                         * "anual" liga para contestar — e tem razão em ligar.
                         */
                        description: proporcional
                            ? `Diferença proporcional até a renovação — mudança para ${planConfig.name}`
                            : (anual
                                  ? `12 meses do ${planConfig.name} com 10% de desconto`
                                  : `Mensalidade do ${planConfig.name}`) +
                              (adicionais > 0
                                  ? `, com ${adicionais} unidade(s) adicional(is)`
                                  : ''),
                        quantity: 1,
                        value: valor,
                    },
                ],
                /**
                 * Cliente conhecido entra por id; desconhecido, por dados.
                 *
                 * Só o primeiro checkout de uma conta manda `customerData` — e
                 * é ele que cria o cliente no Asaas. Do segundo em diante existe
                 * `asaasCustomerId`, e mandar os dados de novo criaria um
                 * cliente duplicado com o mesmo documento.
                 *
                 * A busca por CNPJ **não** serve para o primeiro: o CNPJ de uma
                 * clínica pode já estar no Asaas do Andre sob outro nome — foi o
                 * caso da própria Venn360, cujo documento também pertence a um
                 * cliente "Avant Empresarial" criado em 2025. Ligar a cobrança
                 * ao registro errado é pior que criar um certo.
                 */
                ...(asaasCustomerId
                    ? { customer: asaasCustomerId }
                    : dadosCompletos(pagador)
                      ? { customerData: dadosCompletos(pagador) }
                      : {}),
                // Avulso não leva recorrência: a assinatura já existe, e criar
                // outra é a cobrança dobrada que custou caro hoje.
                ...(proporcional
                    ? {}
                    : {
                        subscription: {
                            cycle: CICLOS[ciclo].asaas,
                            nextDueDate: hoje,
                        },
                    }),
            },
        })

        await prisma.asaasCheckout.update({
            where: { id: tentativa.id },
            data: {
                asaasCheckoutId: resposta.id,
                link: resposta.link,
                status: resposta.status ?? 'ACTIVE',
            },
        })

        return { link: resposta.link, checkoutId: resposta.id }
    } catch (erro) {
        // A tentativa morre junto com a chamada que falhou: deixá-la "ACTIVE"
        // faria a tela anunciar um pagamento em andamento que não existe.
        await prisma.asaasCheckout.update({
            where: { id: tentativa.id },
            data: { status: 'CANCELED' },
        })
        throw erro
    }
}

/**
 * O checkout da cesta de adicionais: crédito avulso, unidades, ou os dois.
 *
 * **Uma cobrança só, DETACHED.** A tela vende as duas coisas no mesmo diálogo e
 * o cliente clica uma vez; dois checkouts seriam duas janelas, duas aprovações
 * e a chance de pagar uma e abandonar a outra — com metade da cesta entregue.
 *
 * E DETACHED mesmo para a unidade, que é recorrente: o que se cobra aqui é o
 * proporcional dos dias que faltam. A recorrência já existe, e quem sobe o valor
 * dela para os próximos ciclos é o processador do webhook, com um `PUT` na
 * assinatura. Criar uma segunda assinatura para o adicional é exatamente a
 * cobrança dobrada que custou caro no dia da troca de plano.
 *
 * Por ser avulsa, aceita **Pix**, que confirma em segundos — recorrente é que é
 * cartão e só cartão.
 */
export async function criarCheckoutDeAdicionais(opcoes: {
    accountId: string
    workspaceId: string
    /** O plano vigente, só para a linha saber a que assinatura ela pertence. */
    plan: PlanId
    pacote?: { credits: number; price: number } | null
    unidades: number
    /** Quanto as unidades custam agora, proporcional aos dias que faltam. */
    valorDasUnidades: number
    /** Quantos treinamentos de agente, e o preço unitário vigente. */
    treinamentos?: number
    precoDoTreinamento?: number
    pagador: DadosDoPagador
    asaasCustomerId?: string | null
    baseUrl: string
}): Promise<{ link: string; checkoutId: string }> {
    const {
        accountId,
        workspaceId,
        plan,
        pacote,
        unidades,
        valorDasUnidades,
        treinamentos = 0,
        precoDoTreinamento = 0,
        pagador,
        asaasCustomerId,
        baseUrl,
    } = opcoes

    const valorDoPacote = pacote ? pacote.price : 0
    const valorDosTreinamentos = Math.max(0, treinamentos) * precoDoTreinamento
    const valor =
        Math.round((valorDoPacote + valorDasUnidades + valorDosTreinamentos) * 100) / 100

    /**
     * Um item por natureza, porque a fatura é lida por gente.
     *
     * "Adicionais R$ 339,00" obriga quem abre o extrato a lembrar o que comprou.
     * Duas linhas dizem, e é o mesmo trabalho.
     */
    const items: { name: string; description: string; quantity: number; value: number }[] = []

    if (pacote) {
        items.push({
            name: `${pacote.credits.toLocaleString('pt-BR')} créditos de IA`,
            description: 'Crédito avulso, válido por 90 dias a partir da compra',
            quantity: 1,
            value: pacote.price,
        })
    }

    if (treinamentos > 0 && valorDosTreinamentos > 0) {
        items.push({
            name:
                treinamentos === 1
                    ? TREINAMENTO.nome
                    : `${treinamentos} × ${TREINAMENTO.nome}`,
            description:
                'Serviço de implantação: levantamento do conteúdo, escrita dos documentos ' +
                'do agente e ajuste das respostas. Compra única',
            quantity: 1,
            value: valorDosTreinamentos,
        })
    }

    if (unidades > 0 && valorDasUnidades > 0) {
        items.push({
            name: `${unidades} unidade${unidades === 1 ? '' : 's'} adicional${unidades === 1 ? '' : 'is'}`,
            description:
                `Proporcional até a renovação. A partir do próximo ciclo, ` +
                `${unidades === 1 ? 'ela soma' : 'elas somam'} ao valor da mensalidade`,
            quantity: 1,
            value: valorDasUnidades,
        })
    }

    // A linha nasce antes da chamada, com o id que vai no `externalReference`:
    // mesma ordem, e pela mesma razão, do checkout de plano.
    const tentativa = await prisma.asaasCheckout.create({
        data: {
            accountId,
            workspaceId,
            plan,
            asaasCheckoutId: `pendente:${accountId}:${Date.now()}`,
            link: '',
            kind: 'adicionais',
            valueCents: Math.round(valor * 100),
            packCredits: pacote?.credits ?? null,
            packPriceCents: pacote ? Math.round(pacote.price * 100) : null,
            units: unidades > 0 ? unidades : null,
            trainings: treinamentos > 0 ? treinamentos : null,
        },
        select: { id: true },
    })

    try {
        const resposta = await asaas<RespostaCheckout>('/checkouts', {
            method: 'POST',
            body: {
                billingTypes: AVULSO,
                chargeTypes: ['DETACHED'],
                /**
                 * Uma hora, e não um dia.
                 *
                 * Decisão do Andre em 2026-10-20. Checkout aberto por 24h é
                 * cobrança que o cliente esqueceu que começou — e, enquanto
                 * ele vive, a tela anuncia "pagamento em andamento" para uma
                 * página que ninguém vai abrir de novo. Em 60 minutos ou se
                 * paga ou se desiste, e desistir é barato: contratar de novo é
                 * um clique.
                 */
                minutesToExpire: 60,
                externalReference: tentativa.id,
                callback: {
                    successUrl: `${baseUrl}/pagamento/retorno?status=processando`,
                    cancelUrl: `${baseUrl}/pagamento/retorno?status=cancelado`,
                    expiredUrl: `${baseUrl}/pagamento/retorno?status=expirado`,
                },
                items,
                ...(asaasCustomerId
                    ? { customer: asaasCustomerId }
                    : dadosCompletos(pagador)
                      ? { customerData: dadosCompletos(pagador) }
                      : {}),
            },
        })

        await prisma.asaasCheckout.update({
            where: { id: tentativa.id },
            data: {
                asaasCheckoutId: resposta.id,
                link: resposta.link,
                status: resposta.status ?? 'ACTIVE',
            },
        })

        return { link: resposta.link, checkoutId: resposta.id }
    } catch (erro) {
        await prisma.asaasCheckout.update({
            where: { id: tentativa.id },
            data: { status: 'CANCELED' },
        })
        throw erro
    }
}
