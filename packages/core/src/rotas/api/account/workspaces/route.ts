import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { adicionaisCobraveis, adicionaisVivos, contaDoMaster, unidadesDaConta, unidadesNoAr } from '@venn/core/lib/account'
import { tetoDeUnidades } from '@venn/core/lib/plan-limits'
import { lerFusoDasConfiguracoes } from '@venn/core/lib/fuso-da-unidade'
import { planFor } from '@venn/core/lib/plans'
import { vocab } from '../../../../lib/vocabulario'
import { comArtigo } from '../../../../lib/concordancia'

/**
 * As unidades da conta: listar e criar.
 *
 * Mora em `account/` e não em `workspace/` de propósito — o sujeito aqui é a
 * conta, que é quem tem unidades e quem paga por elas. `account/workspace`
 * (singular) continua sendo "a unidade aberta agora".
 */

/** Recusa de teto, para atravessar a transação sem virar 500. */
class AcimaDoTeto extends Error {
    constructor(
        readonly existentes: number,
        readonly max: number,
        /**
         * Quantas contratações canceladas ainda estão de pé, e até quando.
         *
         * Muda a frase da recusa, não a decisão: com elas, o teto de hoje
         * comporta a unidade e o da renovação não — e a saída não é "mude de
         * plano", é restaurar o que foi cancelado ou contratar de novo.
         */
        readonly canceladas = 0,
        readonly ate: Date | null = null
    ) {
        super('acima do teto de unidades')
    }
}

const criarSchema = z.object({
    name: z.string().trim().min(2, 'Dê um nome à unidade.').max(80),
})

/** Só as letras, números e hifens — e sem acento, que não sobrevive em URL. */
function slugDe(nome: string): string {
    return nome
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
}

/**
 * Um slug livre a partir do nome.
 *
 * O slug é único no sistema inteiro, não na conta: duas clínicas chamadas
 * "Centro" em contas diferentes colidem, e quem chegou depois não tem culpa
 * nenhuma. O sufixo numérico é o que evita devolver um erro que a pessoa não
 * tem como resolver — ela não sabe que o nome já existe na conta de outro.
 */
async function slugLivre(
    /** O cliente da transação — consultar pelo global dentro dela gasta uma segunda conexão. */
    db: Pick<typeof prisma, 'workspace'>,
    nome: string
): Promise<string> {
    const base = slugDe(nome) || 'unidade'
    for (let n = 1; n <= 50; n++) {
        const tentativa = n === 1 ? base : `${base}-${n}`
        const existe = await db.workspace.findUnique({
            where: { slug: tentativa },
            select: { id: true },
        })
        if (!existe) return tentativa
    }
    return `${base}-${Date.now()}`
}

export async function GET() {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const workspace = await prisma.workspace.findUnique({
        where: { id: auth.member.workspaceId },
        select: { accountId: true, account: { select: { name: true, ownerUserId: true } } },
    })
    if (!workspace) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 })

    const [unidades, lista, minhas, subscription] = await Promise.all([
        unidadesDaConta(workspace.accountId),
        prisma.workspace.findMany({
            where: { accountId: workspace.accountId },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                name: true,
                address: true,
                phone: true,
                createdAt: true,
                suspendedAt: true,
                // O fuso mora dentro de `settings`; a coluna inteira não sai
                // daqui — a tela recebe só o fuso, já resolvido.
                settings: true,
                _count: {
                    select: {
                        users: true,
                        contacts: true,
                        agents: true,
                        conversations: true,
                    },
                },
            },
        }),
        /**
         * De quais delas esta pessoa participa.
         *
         * Ser MASTER da conta não é participar da unidade, e a diferença
         * aparece na tela: sem isto ela ofereceria "Abrir" numa clínica que o
         * seletor não vai aceitar, porque a troca confere participação — e o
         * clique terminaria num 403 sem explicação.
         */
        prisma.workspaceUser.findMany({
            where: { userId: auth.member.userId, isActive: true },
            select: { workspaceId: true },
        }),
        prisma.subscription.findUnique({
            where: { accountId: workspace.accountId },
            select: { plan: true },
        }),
    ])

    const participo = new Set(minhas.map((m) => m.workspaceId))

    /**
     * Quantos canais cada unidade tem.
     *
     * Fora do `_count` porque o canal pende do **agente**, não da unidade, e
     * `_count` não atravessa duas relações. Uma consulta só para a conta
     * inteira, somada em memória: são dezenas de linhas, não milhares.
     */
    const agentesComCanais = await prisma.agent.findMany({
        where: { workspace: { accountId: workspace.accountId } },
        select: { workspaceId: true, _count: { select: { integrations: true } } },
    })

    const canaisPorUnidade = new Map<string, number>()
    for (const a of agentesComCanais) {
        canaisPorUnidade.set(
            a.workspaceId,
            (canaisPorUnidade.get(a.workspaceId) ?? 0) + a._count.integrations
        )
    }

    return NextResponse.json({
        conta: workspace.account.name,
        /** Se quem pergunta é o MASTER — a tela esconde o que ele não pode fazer. */
        souMaster: workspace.account.ownerUserId === auth.member.userId,
        aberta: auth.member.workspaceId,
        unidades,
        /** O nome do plano, para a tela poder explicar de onde vem o teto. */
        plano: subscription ? planFor(subscription.plan).name : null,
        lista: lista.map((u) => ({
            id: u.id,
            name: u.name,
            address: u.address,
            phone: u.phone,
            createdAt: u.createdAt,
            suspendedAt: u.suspendedAt,
            usuarios: u._count.users,
            pacientes: u._count.contacts,
            agentes: u._count.agents,
            conversas: u._count.conversations,
            canais: canaisPorUnidade.get(u.id) ?? 0,
            participo: participo.has(u.id),
            fusoHorario: lerFusoDasConfiguracoes(u.settings),
        })),
    })
}

/**
 * Cria uma unidade dentro da conta que já existe.
 *
 * Nasce **vazia e com uma pessoa dentro**: quem criou, como OWNER. Sem isso a
 * unidade seria criada e ninguém poderia abri-la — nem quem a criou, porque o
 * seletor da marca lista participações, não contas.
 *
 * Não copia nada da unidade de origem (etapas do funil, departamentos, tags).
 * Copiar parecia gentileza e é armadilha: a clínica nova herdaria um funil que
 * não é dela e descobriria isso depois de cadastrar negócio nele.
 */
export async function POST(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const master = await contaDoMaster(auth.member.workspaceId, auth.member.userId)
    if (!master.ok) {
        return NextResponse.json(
            {
                error:
                    master.status === 403
                        ? 'Só o responsável pela conta pode criar unidades.'
                        : master.error,
            },
            { status: master.status }
        )
    }

    const parsed = criarSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' },
            { status: 400 }
        )
    }

    /**
     * O teto é conferido **dentro** da transação, junto da criação.
     *
     * Conferir antes e criar depois é a corrida clássica: dois cliques no botão,
     * duas conferências que passam, duas unidades numa conta que cabe uma — e
     * uma delas de graça. A contagem e a inserção na mesma transação fecham a
     * janela.
     */
    try {
        const criada = await prisma.$transaction(async (tx) => {
            const [existentes, adicionais, cobraveis, subscription] = await Promise.all([
                tx.workspace.count({ where: { accountId: master.accountId, ...unidadesNoAr } }),
                tx.unitAddon.count({ where: { accountId: master.accountId, ...adicionaisVivos() } }),
                /** As que não foram canceladas: são as que existirão depois da renovação. */
                tx.unitAddon.count({
                    where: { accountId: master.accountId, ...adicionaisCobraveis },
                }),
                tx.subscription.findUnique({
                    where: { accountId: master.accountId },
                    select: { plan: true, currentPeriodEnd: true },
                }),
            ])

            /**
             * A contagem é refeita **dentro da transação**, e não lida de
             * `unidadesDaConta`, embora a conta seja a mesma: conferir fora e
             * criar dentro reabre a corrida que esta transação existe para
             * fechar — dois cliques, duas conferências que passam, duas
             * unidades numa conta que cabe uma.
             */

            /**
             * Duas contas, e vale a **menor**.
             *
             * O teto de hoje conta a contratação cancelada, que ainda vale até
             * a renovação. Criar uma clínica nessa folga seria cadastrar hoje o
             * que some em trinta dias: na virada o teto cai, o cron pausa
             * agente e desconecta número, e a clínica fica de pé sem contratação
             * que a sustente — com agenda e pacientes dentro.
             *
             * O plano não precisa do mesmo cuidado: num downgrade pendente a
             * coluna `plan` já guarda o plano novo, então o teto calculado dela
             * já é o de depois da renovação.
             */
            const max = tetoDeUnidades(subscription?.plan, adicionais)
            const maxDepois = tetoDeUnidades(subscription?.plan, cobraveis)

            if (existentes >= Math.min(max, maxDepois)) {
                throw new AcimaDoTeto(
                    existentes,
                    Math.min(max, maxDepois),
                    adicionais - cobraveis,
                    subscription?.currentPeriodEnd ?? null
                )
            }

            const workspace = await tx.workspace.create({
                data: {
                    accountId: master.accountId,
                    name: parsed.data.name,
                    slug: await slugLivre(tx, parsed.data.name),
                    users: { create: { userId: auth.member.userId, role: 'OWNER' } },
                },
                select: { id: true, name: true, slug: true },
            })

            return workspace
        })

        return NextResponse.json(criada, { status: 201 })
    } catch (error) {
        if (error instanceof AcimaDoTeto) {
            /**
             * Quando o teto que barra é o **de depois da renovação**, dizer
             * "seu plano cabe N" seria mentira: hoje cabe mais. A frase precisa
             * nomear a causa — contratação cancelada — e a saída, que é
             * restaurá-la, não mudar de plano.
             */
            const ate = error.ate
                ? error.ate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                : 'a renovação'

            return NextResponse.json(
                {
                    error:
                        error.canceladas > 0
                            ? `Você tem ${error.canceladas} contratação${error.canceladas === 1 ? '' : 'ões'} adicional${error.canceladas === 1 ? '' : 'is'} cancelada${error.canceladas === 1 ? '' : 's'}, ` +
                              `que vale${error.canceladas === 1 ? '' : 'm'} só até ${ate}. ` +
                              `Criar ${comArtigo(vocab(), 'organizacao', 'um')} agora deixaria ela sem contratação depois dessa data. ` +
                              `Restaure a contratação em Assinatura → Alterar adicionais, ou contrate outra.`
                            : `Seu plano cabe ${error.max} unidade${error.max === 1 ? '' : 's'} e você já tem ${error.existentes}. ` +
                              `Contrate uma unidade adicional em Gerenciamento → Conta → Assinatura → Comprar adicionais.`,
                },
                { status: 402 }
            )
        }
        console.error('[ACCOUNT_WORKSPACES_POST]', error)
        return NextResponse.json({ error: 'Não foi possível criar a unidade' }, { status: 500 })
    }
}
