import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import { currentMembership } from '@/lib/auth/workspace'
import { enderecoDoRetrato, guardarRetrato } from '@/lib/retratos'

// GET /api/account/profile - Get current user profile
export async function GET() {
    try {
        console.log('[PROFILE_GET] Starting...')
        const user = await usuarioDaSessao()


        if (!user) {
            console.log('[PROFILE_GET] No user found, returning 401')
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: {
                id: true,
                email: true,
                name: true,
                lastName: true,
                phone: true,
                updatedAt: true,
                createdAt: true,
            }
        })

        console.log('[PROFILE_GET] DB user found:', dbUser?.id)

        if (!dbUser) {
            return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
        }

        // Endereço, não a coluna: a tela desenha `<img src>`, e a coluna guarda
        // `ref:publico:…`. Mesmo contrato do PATCH.
        const { updatedAt, ...resto } = dbUser
        return NextResponse.json({
            ...resto,
            avatar: enderecoDoRetrato('usuario', dbUser.id, updatedAt),
        })
    } catch (error) {
        console.error('[API] Error fetching profile:', error)
        return NextResponse.json({ error: 'Erro ao buscar perfil' }, { status: 500 })
    }
}

// PATCH /api/account/profile - Update user profile
export async function PATCH(request: NextRequest) {
    try {
        console.log('[PROFILE_PATCH] Starting...')
        const user = await usuarioDaSessao()


        if (!user) {
            console.log('[PROFILE_PATCH] No user found, returning 401')
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const body = await request.json()
        const { name, lastName, phone, avatar } = body

        console.log('[PROFILE_PATCH] Updating user:', user.id, { name, lastName, phone, hasAvatar: !!avatar })

        /**
         * A foto vai para o **acervo**, e a coluna recebe a referência.
         *
         * Esta rota era o último lugar do produto que gravava imagem dentro de
         * uma coluna: a tela manda `data:image/png;base64,…` e isso ia direto
         * para `users.avatar`. Medido em produção antes de consertar: 275 kB em
         * dois usuários, um deles com 277.026 bytes — e meia dúzia de consultas
         * trazendo aquilo para decidir se havia foto.
         *
         * Anexo de conversa e foto de contato já iam para o acervo; o perfil
         * ficou para trás.
         *
         * **Falha o pedido quando o acervo recusa**, em vez de cair para o data
         * URI. O fallback silencioso traria de volta exatamente o que isto
         * existe para tirar, e ninguém notaria até a tabela crescer de novo.
         */
        let avatarParaGravar: string | null | undefined = undefined
        if (avatar !== undefined) {
            if (!avatar) {
                avatarParaGravar = null
            } else {
                const membro = await currentMembership()
                if (!membro) {
                    return NextResponse.json(
                        { error: 'Workspace não encontrado' },
                        { status: 404 }
                    )
                }
                const guardado = await guardarRetrato({
                    workspaceId: membro.workspaceId,
                    sujeito: 'usuario',
                    sujeitoId: user.id,
                    valor: avatar,
                })
                if (!guardado) {
                    return NextResponse.json(
                        { error: 'Não foi possível guardar a foto. Tente de novo.' },
                        { status: 502 }
                    )
                }
                avatarParaGravar = guardado.referencia
            }
        }

        const dbUser = await prisma.user.update({
            where: { id: user.id },
            data: {
                name: name !== undefined ? name : undefined,
                lastName: lastName !== undefined ? lastName : undefined,
                phone: phone !== undefined ? phone : undefined,
                avatar: avatarParaGravar,
            },
            select: {
                id: true,
                email: true,
                name: true,
                lastName: true,
                phone: true,
                updatedAt: true,
            }
        })

        console.log('[PROFILE_PATCH] Success, updated user:', dbUser.id)
        /**
         * `avatar` sai da resposta e entra como **endereço**.
         *
         * A coluna guarda `ref:publico:…`, que a tela não sabe desenhar — e
         * devolver a referência crua foi o que, numa versão anterior deste
         * produto, fez aparecerem `ref:clinico:…` como texto dentro de um
         * `<img>`. O endereço é o contrato com a tela; a referência é interna.
         */
        const { updatedAt, ...resto } = dbUser
        return NextResponse.json({
            ...resto,
            avatar: enderecoDoRetrato('usuario', dbUser.id, updatedAt),
        })
    } catch (error) {
        console.error('[API] Error updating profile:', error)
        return NextResponse.json({ error: 'Erro ao atualizar perfil' }, { status: 500 })
    }
}
