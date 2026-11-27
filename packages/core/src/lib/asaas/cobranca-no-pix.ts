import prisma from '@venn/db/cliente'
import { asaas } from './client'
import type { PlanId } from '../plan-limits'

/**
 * Cobrar por Pix **dentro do app**, com o QR Code na nossa tela.
 *
 * Irmã de `cobranca-no-cartao.ts`, e a forma é deliberadamente a mesma: cria a
 * cobrança por `POST /v3/payments`, grava a tentativa antes, e deixa a entrega
 * para quem sabe que o dinheiro entrou.
 *
 * ## Por que o Pix pode ser embutido e o cartão não
 *
 * Porque QR Code e copia-e-cola **não têm PAN**. A razão de o cartão passar
 * pela página do Asaas é de escopo de PCI (`PRODUCT.md` §13): tokenizar no
 * servidor é transmitir dado de cartão, e isso tira a aplicação do SAQ A. Nada
 * disso vale para Pix — não há dado de portador em lugar nenhum do fluxo, então
 * exibir o QR aqui não move escopo nenhum.
 *
 * É por isso que a Fase 2 fez o Pix e não o cartão. A fronteira não é de
 * conveniência, é de responsabilidade.
 *
 * ## Avulso, nunca recorrência
 *
 * `DETACHED` por construção, e isso não é escolha: o Asaas recusa Pix em
 * operação recorrente, em letra — *"CREDIT_CARD é o único método de pagamento
 * permitido para operações RECURRENT"*. Cobrar sozinho todo mês exige
 * credencial guardada, e Pix não tem.
 *
 * Plano mensal em Pix é **Pix Automático**, produto separado com autorização do
 * pagador confirmada pela instituição dele
 * (`POST /v3/pix/automatic/authorizations`). Fica para fase própria; ver §13.
 *
 * ## A entrega é sempre do webhook
 *
 * O cartão salvo confirma na resposta da própria chamada, e por isso a rota
 * entrega ali mesmo. Pix **nunca** confirma na criação: nasce `PENDING` e vira
 * `RECEIVED` quando a pessoa paga, segundos ou horas depois. Então aqui não há
 * caminho de entrega — quem entrega é `entregarCestaDoPagamento`, no
 * processador de eventos, pelo `externalReference` que esta cobrança leva desde
 * o nascimento. A trava é `appliedAt`, a mesma de sempre.
 *
 * O efeito prático é bom: não existe o caso "a tela disse que entregou e o
 * dinheiro não entrou". A tela mostra o QR e espera o banco.
 */

interface PagamentoCriado {
    id: string
    status?: string
    invoiceUrl?: string
    value?: number
}

/** O que `GET /v3/payments/{id}/pixQrCode` devolve, pelos campos documentados. */
interface QrCodeDoAsaas {
    /** A imagem do QR em Base64, **sem** o prefixo `data:`. */
    encodedImage?: string
    /** O copia-e-cola. */
    payload?: string
    /** Quando o QR expira. */
    expirationDate?: string
}

export interface CobrancaNoPix {
    /** A linha de tentativa, para a tela poder consultar o estado dela. */
    tentativaId: string
    paymentId: string
    /**
     * O valor cobrado, em centavos — e ele vem **daqui**, não da tela.
     *
     * A tela precisa dele para escrever o número ao lado do QR, e recalculá-lo
     * no cliente criaria uma segunda conta de dinheiro: no dia em que o preço de
     * um adicional mudar, o QR cobraria um valor e a tela anunciaria outro. É a
     * mesma razão pela qual os preços dos planos viajam prontos do servidor.
     */
    valorCentavos: number
    /** A imagem do QR em Base64, pronta para `src`. */
    imagemBase64: string
    /** O copia-e-cola, para o botão de copiar. */
    copiaECola: string
    /** Quando o QR deixa de valer, se o Asaas disse. */
    expiraEm: string | null
    /** A fatura deles, como alternativa — e como resgate se a tela fechar. */
    invoiceUrl: string | null
}

export async function cobrarNoPix(opcoes: {
    accountId: string
    workspaceId: string
    plan: PlanId
    asaasCustomerId: string
    valor: number
    descricao: string
    pacote?: { credits: number; price: number } | null
    unidades: number
    treinamentos?: number
}): Promise<CobrancaNoPix> {
    const {
        accountId,
        workspaceId,
        plan,
        asaasCustomerId,
        valor,
        descricao,
        pacote,
        unidades,
        treinamentos = 0,
    } = opcoes

    /**
     * A linha nasce antes da cobrança, como em todo caminho de dinheiro aqui: o
     * id dela vai no `externalReference`, e é por ele que o webhook sabe o que
     * entregar. Na ordem inversa sobraria um Pix pago que ninguém saberia a quem
     * atribuir.
     */
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
        /**
         * Vencimento **hoje**, em São Paulo.
         *
         * No Pix o vencimento não impede pagar depois — o QR dinâmico vale por
         * doze meses além do vencimento, pela documentação deles. Mas é o
         * vencimento que define quando a cobrança conta como vencida nos
         * relatórios, e uma compra de adicional que fica "a vencer" por uma
         * semana suja a conciliação de quem olha o painel do Asaas.
         */
        const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

        const pagamento = await asaas<PagamentoCriado>('/payments', {
            method: 'POST',
            body: {
                customer: asaasCustomerId,
                billingType: 'PIX',
                value: valor,
                dueDate: hoje,
                description: descricao,
                externalReference: tentativa.id,
            },
        })

        /**
         * A tentativa aprende o id do pagamento **antes** de buscar o QR.
         *
         * A ordem importa e é a razão de serem duas escritas. O QR vem numa
         * segunda chamada, que pode falhar sozinha — e, se falhar, a cobrança
         * **já existe e é pagável**. Gravando o id agora, o `catch` lá embaixo
         * consegue distinguir "a cobrança não nasceu" de "nasceu e o QR não
         * veio", e não cancela no nosso banco o que segue vivo no deles.
         *
         * Gravando só no fim, as duas falhas ficariam idênticas vistas do banco
         * — a linha ainda com `pendente:` — e a limpeza mataria a linha de uma
         * cobrança que o cliente pode pagar pela fatura. Dinheiro entrando sem
         * dono, que é exatamente o que a ordem gravar-antes-de-chamar existe
         * para impedir.
         */
        await prisma.asaasCheckout.update({
            where: { id: tentativa.id },
            data: {
                asaasCheckoutId: pagamento.id,
                /**
                 * `link` guarda a fatura deles, como no cartão salvo.
                 *
                 * Não guardamos o QR nem o copia-e-cola: eles são derivados da
                 * cobrança e o Asaas os devolve de novo a qualquer momento. Uma
                 * cópia aqui seria um segundo lugar com validade própria para a
                 * mesma coisa — e, se o QR for reemitido, a cópia velha é a que
                 * a tela mostraria.
                 */
                link: pagamento.invoiceUrl ?? '',
                /**
                 * `ACTIVE` sempre: Pix nasce pendente, e `PAID` aqui seria
                 * anunciar um pagamento que ninguém fez. Quem move para `PAID`
                 * é o webhook, junto com `appliedAt`.
                 */
                status: 'ACTIVE',
            },
        })

        const qr = await asaas<QrCodeDoAsaas>(`/payments/${pagamento.id}/pixQrCode`)

        return {
            tentativaId: tentativa.id,
            paymentId: pagamento.id,
            valorCentavos: Math.round(valor * 100),
            imagemBase64: qr.encodedImage ?? '',
            copiaECola: qr.payload ?? '',
            expiraEm: qr.expirationDate ?? null,
            invoiceUrl: pagamento.invoiceUrl ?? null,
        }
    } catch (erro) {
        /**
         * Tentativa morta junto com a cobrança que não nasceu.
         *
         * **Mas só quando ela não nasceu.** Se o `POST /payments` passou e foi o
         * QR que falhou, cancelar aqui marcaria `CANCELED` uma cobrança viva no
         * Asaas, e o webhook do pagamento dela não entregaria a cesta —
         * `entregarCestaDoPagamento` não olha o status da tentativa, mas a tela
         * leria "cancelada" sobre dinheiro que entrou.
         *
         * Então a limpeza é condicional: só desiste da linha se ela ainda não
         * tem id de pagamento do Asaas.
         */
        const atual = await prisma.asaasCheckout.findUnique({
            where: { id: tentativa.id },
            select: { asaasCheckoutId: true },
        })

        if (atual?.asaasCheckoutId.startsWith('pendente:')) {
            await prisma.asaasCheckout.update({
                where: { id: tentativa.id },
                data: { status: 'CANCELED' },
            })
        }

        throw erro
    }
}
