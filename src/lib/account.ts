import prisma from '@/lib/prisma'
import { limitsFor, tetoDeUnidades } from '@/lib/plan-limits'

/**
 * A ponte entre a unidade e quem paga por ela.
 *
 * A assinatura deixou de ser do workspace e passou a ser da conta em
 * 2026-10-18, para que o Multiclínica possa incluir mais de uma unidade. As 56
 * chamadas que pedem cobrança continuam passando `workspaceId` — é o que elas
 * têm em mãos, e trocar a assinatura de todas elas seria espalhar o conceito de
 * conta por meia aplicação. A tradução acontece aqui.
 *
 * Hoje é uma conta por workspace e isto devolve sempre a mesma coisa que antes.
 * Com três unidades na mesma conta, as três resolvem para **a mesma
 * assinatura** — que é exatamente o ponto: franquia e crédito somados, uma
 * renovação, uma fatura.
 */

/**
 * O filtro de "a assinatura da conta dona desta unidade", para leitura.
 *
 * Nested em vez de duas consultas: o Postgres resolve o `some` como subconsulta
 * e a cobrança é lida em todo carregamento de tela — uma ida a menos ao banco
 * por leitura importa mais aqui que em outro lugar.
 */
export function assinaturaDaUnidade(workspaceId: string) {
    return { account: { workspaces: { some: { id: workspaceId } } } }
}

/**
 * O filtro de "em qualquer unidade da conta dona desta unidade".
 *
 * Para as tabelas que gravam `workspaceId` mas respondem a um teto da conta:
 * crédito avulso comprado e respostas faladas medidas. Lidas por unidade, elas
 * recriavam exatamente o defeito que a franquia por conta existe para evitar —
 * o crédito que a clínica comprou ficava preso na unidade onde foi comprado, e
 * o teto de áudio se multiplicava por unidade.
 *
 * Aninhado em vez de resolver o `accountId` antes: é uma ida ao banco a menos
 * num caminho que o worker percorre a cada resposta do agente.
 */
export function daContaDaUnidade(workspaceId: string) {
    return { workspace: { account: { workspaces: { some: { id: workspaceId } } } } }
}

/**
 * O id da conta dona desta unidade, para escrita.
 *
 * Escrita precisa do id: `update` e `upsert` pedem seletor único, e
 * `accountId` é o único que a assinatura tem agora. Devolve `null` para
 * workspace que não existe — quem chama decide se isso é 404 ou criar.
 */
export async function accountIdOf(workspaceId: string): Promise<string | null> {
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { accountId: true },
    })
    return workspace?.accountId ?? null
}

/**
 * Quantas unidades a conta pode ter, quantas tem, e quantas sobram.
 *
 * O teto é **o que o plano inclui mais as unidades compradas à parte**. A
 * segunda metade é o que faz o adicional de R$ 290 funcionar em qualquer plano:
 * um Digital com dois adicionais tem três unidades, sem precisar virar
 * Multiclínica. Ver PRODUCT.md §12.
 *
 * Conta sem assinatura fica com o teto do plano de entrada (uma), e não com
 * zero: ela **tem** uma unidade — é por ela que a pessoa está logada —, e
 * devolver zero faria a tela anunciar "1 de 0".
 */
export interface Unidades {
    used: number
    max: number
    remaining: number
    /** O que o plano inclui, separado para a tela poder explicar o teto. */
    doPlano: number
    /** Quantas foram compradas à parte. */
    adicionais: number
}

/**
 * O filtro que separa adicional vivo de adicional cancelado.
 *
 * Cancelar um adicional não apaga a linha: o ciclo foi pago e a unidade vale
 * até o fim dele. Então "quantos adicionais esta conta tem" é sempre uma
 * pergunta **com data**, e a resposta muda sozinha na virada.
 *
 * Exportado porque três lugares precisam concordar — a contagem de unidades, a
 * renovação que reescreve os tetos e o valor que vai para o gateway. Um deles
 * contando linha cancelada é teto que não cai, ou cobrança que não desce.
 */
export function adicionaisVivos(em: Date = new Date()) {
    return { OR: [{ endsAt: null }, { endsAt: { gt: em } }] }
}

export async function unidadesDaConta(accountId: string): Promise<Unidades> {
    const [used, adicionais, subscription] = await Promise.all([
        prisma.workspace.count({ where: { accountId } }),
        prisma.unitAddon.count({ where: { accountId, ...adicionaisVivos() } }),
        prisma.subscription.findUnique({
            where: { accountId },
            select: { plan: true },
        }),
    ])

    const doPlano = limitsFor(subscription?.plan).maxWorkspaces
    const max = tetoDeUnidades(subscription?.plan, adicionais)

    return { used, max, remaining: Math.max(0, max - used), doPlano, adicionais }
}

/**
 * Quem pode mexer nas unidades da conta: o MASTER dela.
 *
 * Não é o OWNER da unidade aberta. Criar unidade gasta o teto que a conta
 * comprou, e mexer no CNPJ de cobrança mexe na fatura — a conta tem **um**
 * responsável explícito (`Account.ownerUserId`), e foi para isto que a coluna
 * existe. Com três unidades, "o OWNER de qual delas?" não tem resposta boa, e a
 * pergunta aparece justamente quando a resposta importa.
 *
 * A frase da recusa é de quem chama: criar unidade, renomear, trocar o CNPJ e
 * trocar a logo são atos diferentes, e "você não pode criar unidades" na tela de
 * CNPJ manda a pessoa procurar o botão errado.
 */
export async function contaDoMaster(workspaceId: string, userId: string) {
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { accountId: true, account: { select: { ownerUserId: true, name: true } } },
    })
    if (!workspace) return { ok: false as const, status: 404, error: 'Conta não encontrada' }
    if (workspace.account.ownerUserId !== userId) {
        return {
            ok: false as const,
            status: 403,
            error: 'Só o responsável pela conta pode fazer isto.',
        }
    }
    return { ok: true as const, accountId: workspace.accountId }
}
