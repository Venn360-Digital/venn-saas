import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { ROTULO_DO_PAPEL } from '@venn/core/lib/papeis'
import { auth } from '@venn/core/lib/auth/better-auth'
import { diasRestantes, estadoDoConvite, podeAceitar } from '@venn/core/lib/convite/estado'
import { pareceToken, resumoDoToken } from '@venn/core/lib/convite/token'
import prisma from '@venn/db/cliente'

/**
 * O aceite do convite — a única rota **pública** que cria credencial.
 *
 * `GET` diz o que a tela precisa mostrar; `POST` aceita. Pública porque a
 * pessoa ainda não tem login: o token **é** a autenticação, e é por isso que
 * ele é sorteado com 256 bits e guardado em resumo (ver `lib/convite/token`).
 *
 * ## Duas faces, porque a LGPD obriga
 *
 * Se o e-mail convidado **não** tem usuário, a tela pede senha e o usuário
 * nasce aqui. Se **já** tem — a pessoa é de outra unidade da conta, ou de outra
 * conta —, a tela **não pede senha**: ela já tem uma, e trocá-la seria mexer na
 * credencial dela em outro lugar. Aí o aceite é só o vínculo.
 *
 * `GET` devolve `precisaDeSenha` para a tela saber qual face mostrar, e o
 * `POST` **não confia nisso**: ele decide de novo, do seu lado. Um cliente que
 * mandasse senha para um e-mail existente não pode conseguir trocá-la.
 *
 * ## O que esta rota nunca diz
 *
 * Nada sobre a clínica além do nome, e nada sobre quem convidou além do nome.
 * Token inválido e token expirado devolvem a mesma forma de resposta com
 * `estado` diferente — não há enumeração a fazer aqui, porque não há o que
 * adivinhar num token de 256 bits, mas também não há razão para contar mais.
 */

const aceitarSchema = z.object({
    name: z.string().min(1, 'Nome é obrigatório').max(80),
    lastName: z.string().max(80).optional(),
    password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').optional(),
})

async function acharConvite(tokenBruto: string) {
    if (!pareceToken(tokenBruto)) return null
    const tokenHash = await resumoDoToken(tokenBruto)
    return prisma.invite.findUnique({
        where: { tokenHash },
        select: {
            id: true,
            workspaceId: true,
            email: true,
            role: true,
            canTransfer: true,
            recebeConversas: true,
            departmentIds: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
            workspace: { select: { name: true } },
            invitedBy: { select: { name: true } },
        },
    })
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ token: string }> }
) {
    const { token } = await params
    const convite = await acharConvite(token)

    if (!convite) {
        return NextResponse.json({ estado: 'invalido' as const }, { status: 404 })
    }

    const agora = new Date()
    const estado = estadoDoConvite(convite, agora)

    if (estado !== 'pendente') {
        // A tela mostra uma frase por estado; nada da clínica vaza num convite
        // que não vale mais.
        return NextResponse.json({ estado }, { status: 410 })
    }

    const existente = await prisma.user.findUnique({
        where: { email: convite.email },
        select: { id: true, name: true, lastName: true },
    })

    return NextResponse.json({
        estado,
        email: convite.email,
        papel: ROTULO_DO_PAPEL[convite.role as keyof typeof ROTULO_DO_PAPEL] ?? convite.role,
        unidade: convite.workspace.name,
        convidadoPor: convite.invitedBy?.name ?? null,
        diasRestantes: diasRestantes(convite, agora),
        /** A face da tela: pedir senha, ou só confirmar o vínculo. */
        precisaDeSenha: !existente,
        /** Pré-preenche o nome de quem já existe, para não redigitar. */
        nome: existente?.name ?? null,
        sobrenome: existente?.lastName ?? null,
    })
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ token: string }> }
) {
    const { token } = await params
    const convite = await acharConvite(token)
    if (!convite) return NextResponse.json({ error: 'Convite inválido' }, { status: 404 })

    const agora = new Date()
    if (!podeAceitar(convite, agora)) {
        const estado = estadoDoConvite(convite, agora)
        return NextResponse.json(
            {
                error:
                    estado === 'aceito'
                        ? 'Esse convite já foi usado. Entre com o seu e-mail e senha.'
                        : estado === 'revogado'
                          ? 'Esse convite foi cancelado. Peça outro a quem te convidou.'
                          : 'Esse convite expirou. Peça outro a quem te convidou.',
                estado,
            },
            { status: 410 }
        )
    }

    const body = await request.json().catch(() => null)
    const lido = aceitarSchema.safeParse(body)
    if (!lido.success) {
        const primeiro = lido.error.issues[0]
        return NextResponse.json(
            { error: primeiro.message, campo: primeiro.path.join('.') },
            { status: 400 }
        )
    }

    /**
     * Quem o e-mail é, **decidido aqui** e não pelo que o cliente mandou.
     *
     * O `GET` já disse `precisaDeSenha`, e isso é dica para a tela, não
     * contrato: se o cliente mandar senha para um e-mail que já existe, a senha
     * é **ignorada**. Confiar no cliente aqui seria oferecer troca de senha de
     * conta alheia a quem tem um link de convite.
     */
    const existente = await prisma.user.findUnique({
        where: { email: convite.email },
        select: { id: true },
    })

    /**
     * Já é da equipe? Então o convite não tem o que fazer — e o erro tem de
     * dizer **isso**.
     *
     * `POST /api/convites` recusa convidar quem já é membro, então este caso só
     * nasce de uma corrida: convidar a Maria, a Maria entrar na equipe por
     * outro caminho, e só então ela clicar no link. Raro, mas o que acontecia
     * era pior que raro — o `workspaceUser.create` da transação abaixo batia na
     * chave única, a transação voltava atrás, e o `catch` respondia "esse
     * convite já foi usado". Mentira com aparência de explicação: ela não usou
     * convite nenhum, e ficaria procurando o e-mail que já teria clicado.
     *
     * Medido em homologação, com um convite inserido à mão para um e-mail que
     * já era membro: 409 com a frase errada.
     *
     * O 409 fica — é conflito de estado, e não erro de quem clicou —, e a
     * resposta diz o que fazer: entrar.
     */
    if (existente) {
        const jaMembro = await prisma.workspaceUser.findFirst({
            where: { workspaceId: convite.workspaceId, userId: existente.id },
            select: { isActive: true },
        })
        if (jaMembro) {
            return NextResponse.json(
                {
                    error: jaMembro.isActive
                        ? 'Você já faz parte dessa equipe. Entre com o seu e-mail e senha.'
                        : 'Você já faz parte dessa equipe, mas o acesso está desativado. Peça a quem te convidou para reativar.',
                    estado: 'jaMembro' as const,
                },
                { status: 409 }
            )
        }
    }

    if (!existente && !lido.data.password) {
        return NextResponse.json(
            { error: 'Escolha uma senha para o seu acesso.', campo: 'password' },
            { status: 400 }
        )
    }

    const departamentos = Array.isArray(convite.departmentIds)
        ? (convite.departmentIds as unknown[]).filter((v): v is string => typeof v === 'string')
        : []

    /**
     * O hash é feito **antes** da transação.
     *
     * `auth.$context` constrói o contexto do Better Auth, e isso é trabalho de
     * fora do banco. Deixá-lo dentro alongaria a transação pelo tempo do
     * hashing — que é lento de propósito — segurando conexão do Neon sem
     * precisar.
     *
     * E é `password.hash` em vez de `signUpEmail` pela mesma razão que a
     * criação direta já usava: `signUpEmail` emite sessão, e aqui a sessão
     * ainda não deve existir — a pessoa é mandada para o login, que é onde ela
     * prova que sabe a senha que acabou de escolher.
     */
    const hash =
        !existente && lido.data.password
            ? await (await auth.$context).password.hash(lido.data.password)
            : null

    try {
        await prisma.$transaction(async (tx) => {
            let userId = existente?.id

            if (!userId) {
                const criado = await tx.user.create({
                    data: {
                        email: convite.email,
                        name: lido.data.name.trim(),
                        lastName: lido.data.lastName?.trim() || null,
                        /**
                         * `true` porque o convite **foi** a verificação: a
                         * pessoa só chegou aqui por um link que só existia
                         * naquele endereço de e-mail.
                         */
                        emailVerified: true,
                    },
                    select: { id: true },
                })
                userId = criado.id

                await tx.authAccount.create({
                    data: {
                        userId,
                        providerId: 'credential',
                        accountId: userId,
                        password: hash!,
                    },
                })
            }

            await tx.workspaceUser.create({
                data: {
                    workspaceId: convite.workspaceId,
                    userId,
                    role: convite.role,
                    canTransfer: convite.canTransfer,
                    recebeConversas: convite.recebeConversas,
                    isActive: true,
                    ...(departamentos.length
                        ? { departments: { create: departamentos.map((departmentId) => ({ departmentId })) } }
                        : {}),
                },
            })

            /**
             * O convite é marcado **na mesma transação**, e é o que o torna de
             * uso único: um segundo `POST` com o mesmo link cai no
             * `podeAceitar` e recebe 410.
             */
            await tx.invite.update({
                where: { id: convite.id, acceptedAt: null },
                data: { acceptedAt: agora, acceptedUserId: userId },
            })
        })
    } catch (erro) {
        /**
         * A corrida de dois cliques no mesmo link.
         *
         * O `where` do `update` exige `acceptedAt: null`, então a segunda
         * transação não acha a linha e o Prisma lança — e é melhor assim que um
         * `updateMany` silencioso, porque o vínculo da segunda tem de voltar
         * atrás junto.
         */
        console.warn('[CONVITE] aceite não concluído', erro)
        return NextResponse.json(
            { error: 'Esse convite já foi usado. Entre com o seu e-mail e senha.' },
            { status: 409 }
        )
    }

    return NextResponse.json({ ok: true, email: convite.email, jaTinhaConta: Boolean(existente) })
}
