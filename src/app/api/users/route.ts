import { NextRequest, NextResponse } from 'next/server'
import { canSeeEveryone, currentMembership } from '@/lib/auth/workspace'
import prisma from '@/lib/prisma'
import { readAutomations } from '@/lib/automations'
import { estadoVisivel, type StatusDoMembro } from '@/lib/conversas/distribuicao'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import { Prisma } from '#prisma'
import { normalizeSearch } from '@/lib/search'

// GET - List users
export async function GET(request: NextRequest) {
    try {
        console.log('[USERS_GET] Starting...')
        const user = await usuarioDaSessao()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        /**
         * Ver a equipe é de **supervisão**; cadastrar é de gestão.
         *
         * Eram a mesma coisa — `['OWNER','ADMIN']` nos dois —, e isso deixava o
         * GESTOR sem a lista. O recorte que o Andre definiu separa os dois atos:
         * o GESTOR acompanha quem está disponível, de que departamento é cada
         * um e quem está atendendo o quê, e **não** convida ninguém. O
         * ATENDENTE não entra: a guia some da Conta para ele, e isto é o portão
         * que faz a guia sumida não ser só enfeite.
         *
         * `canSeeEveryone` e não uma lista literal: é o mesmo conjunto que
         * decide o seletor "Responsável" nas outras telas, e ele já existe
         * nomeado pelo que decide.
         */
        if (!canSeeEveryone(workspaceUser.role)) {
            return NextResponse.json({ error: 'Permissão negada' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const page = parseInt(searchParams.get('page') || '1')
        const limit = parseInt(searchParams.get('limit') || '20')
        const search = searchParams.get('search') || ''

        const skip = (page - 1) * limit

        const where: Prisma.WorkspaceUserWhereInput = { workspaceId: workspaceUser.workspaceId }

        if (search) {
            // Nome, sobrenome e e-mail vivem na mesma coluna normalizada.
            where.user = { searchText: { contains: normalizeSearch(search) } }
        }

        // The founding member, identified on the whole workspace. Deriving it
        // from the page index instead flagged the wrong person: the first row of
        // page 2, or of a filtered search, and never the founder when their role
        // is OWNER rather than ADMIN.
        const foundingMember = await prisma.workspaceUser.findFirst({
            where: { workspaceId: workspaceUser.workspaceId },
            orderBy: { createdAt: 'asc' },
            select: { id: true }
        })

        /**
         * Quantos atendentes estão sem departamento.
         *
         * O recorte de fila fecha em vez de abrir: atendente sem departamento
         * numa clínica que *tem* departamentos vê só a fila geral. Isso é o
         * certo, e é invisível — ele não aparece reclamando de ver demais.
         * Então a tela conta, e a conta é do workspace inteiro, não da página.
         */
        const [users, total, semDepartamento] = await Promise.all([
            prisma.workspaceUser.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'asc' },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            lastName: true,
                            email: true,
                            phone: true,
                            avatar: true,
                        }
                    },
                    departments: {
                        select: {
                            department: { select: { id: true, name: true } },
                        }
                    }
                }
            }),
            prisma.workspaceUser.count({ where }),
            prisma.workspaceUser.count({
                where: {
                    workspaceId: workspaceUser.workspaceId,
                    isActive: true,
                    role: 'ATENDENTE',
                    departments: { none: {} },
                },
            }),
        ])

        console.log('[USERS_GET] Found', users.length, 'users')

        // O primeiro degrau da escada é configurável, então a derivação precisa
        // dele. Uma consulta a mais na listagem, que não é caminho quente.
        const ws = await prisma.workspace.findUnique({
            where: { id: workspaceUser.workspaceId },
            select: { automations: true },
        })
        const { minutosParaAusente } = readAutomations(ws?.automations)

        return NextResponse.json({
            data: users.map((wu) => ({
                id: wu.id,
                userId: wu.userId,
                name: wu.user.name,
                lastName: wu.user.lastName,
                email: wu.user.email,
                phone: wu.user.phone,
                avatar: wu.user.avatar,
                role: wu.role,
                departments: wu.departments.map((d) => d.department),
                canTransfer: wu.canTransfer,
                isActive: wu.isActive,
                recebeConversas: wu.recebeConversas,
                minutosParaAusente: wu.minutosParaAusente,
                // Derivado, não cru: o gestor olhando a tabela precisa ver o
                // mesmo que a distribuição usa. Mandar o gravado mostraria
                // "Disponível" para quem a escada já pôs em amarelo.
                //
                // E o número é o **da pessoa**, com o da conta como queda —
                // mesma conta de `estaDisponivel`. Usar só o da conta aqui
                // faria a tabela pintar de amarelo quem a distribuição ainda
                // considera disponível, que é a divergência que este
                // comentário já existia para evitar.
                disponibilidade: estadoVisivel(
                    wu.status as StatusDoMembro,
                    wu.ultimaAtividadeEm,
                    wu.minutosParaAusente ?? minutosParaAusente
                ),
                isFirstAdmin: wu.id === foundingMember?.id, // First member is protected
                createdAt: wu.createdAt,
            })),
            semDepartamento,
            /**
             * O padrão da conta, para a ficha dizer qual é no `placeholder` do
             * campo Paciência. Sem isto a tela escreveria "padrão" sem contar
             * qual, e quem fosse mudar não saberia de quanto estava partindo.
             */
            minutosParaAusenteDaConta: minutosParaAusente,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        })
    } catch (error) {
        console.error('[USERS_GET] Error:', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}

// POST - Create new user
/**
 * Criar usuário com senha definida pelo administrador: **não existe mais.**
 *
 * Era este o caminho: o formulário levava um campo `password`, e a rota criava
 * `users` + `auth_accounts` com o hash daquela senha. Saiu por exigência de
 * LGPD — senha é dado de autenticação do titular, e quem a escolhe tem de ser
 * ele, não quem o cadastra.
 *
 * O substituto é `POST /api/convites`: grava o que a pessoa **vai ser**, manda
 * o link, e `User` + `AuthAccount` nascem no aceite, com a senha que ela
 * escolheu.
 *
 * **A rota continua aqui, respondendo 410, em vez de desaparecer.** Um 404
 * seria indistinguível de "errei a URL" para quem estiver depurando, e a
 * mensagem é o que conta a história: cliente velho em cache, script de alguém,
 * ou aba aberta desde antes do deploy recebem a razão em vez de um erro mudo.
 * Quando não houver mais chamada nenhuma nos logs, o arquivo perde a função.
 */
export async function POST() {
    return NextResponse.json(
        {
            error:
                'Criar usuário com senha definida por outra pessoa não é mais possível. ' +
                'Use Convidar: a pessoa recebe um link e escolhe a própria senha.',
            substituto: 'POST /api/convites',
        },
        { status: 410 }
    )
}
