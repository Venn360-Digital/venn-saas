import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { CLASSES, gravar } from '@/lib/storage'
import { comoReferencia } from '@/lib/midia'
import { enderecoDoAvatar } from '@/lib/agents/avatar'
import { MANAGER_ROLES, assertAgentAccess, getWorkspaceMember } from '@/lib/auth/workspace'

/**
 * A imagem do agente.
 *
 * A aba Visual mandava a imagem como data URL dentro do `PATCH /api/agents/[id]`,
 * e o campo `avatar` não existia no schema do zod — então era descartado antes do
 * banco e a imagem nunca era salva. E se tivesse sido aceito seria pior: a coluna
 * é texto, o worker carrega o agente inteiro a cada mensagem recebida, e um
 * retrato em base64 viajaria junto em cada resposta.
 *
 * Aqui o arquivo vai para o Storage, no mesmo balde da mídia das conversas, e a
 * coluna guarda só a URL.
 *
 * Observação de produto que vale estar escrita: este avatar é **interno**. Ele
 * aparece na lista de agentes, na caixa de entrada e no futuro widget do site —
 * e em nenhum canal chega ao paciente. No WhatsApp, Instagram e Messenger a foto
 * que o paciente vê é a da própria conta conectada, definida no app ou no
 * Gerenciador da Meta, e nenhuma API nossa a sobrescreve.
 */

const ALLOWED: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
}

/** Retrato de lista: acima disto é foto de acervo, não avatar. */
const MAX_BYTES = 2 * 1024 * 1024

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await getWorkspaceMember()
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status })
        }

        // Configurar agente é trabalho de gestão, como nas outras rotas de agente.
        if (!MANAGER_ROLES.includes(auth.member.role)) {
            return NextResponse.json(
                { error: 'Você não tem permissão para alterar o agente' },
                { status: 403 }
            )
        }

        const { id: agentId } = await params

        if (!(await assertAgentAccess(agentId, auth.member.workspaceId))) {
            return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
        }

        const form = await request.formData()
        const file = form.get('file')

        if (!(file instanceof File)) {
            return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })
        }

        const extension = ALLOWED[file.type]
        if (!extension) {
            return NextResponse.json(
                { error: 'Formato não suportado. Envie PNG, JPG ou WEBP.' },
                { status: 400 }
            )
        }

        if (file.size > MAX_BYTES) {
            return NextResponse.json(
                { error: `Imagem maior que ${MAX_BYTES / 1024 / 1024} MB` },
                { status: 413 }
            )
        }

        /**
         * Caminho fixo por agente, com `upsert`: a imagem nova substitui a
         * antiga em vez de deixar um rastro de retratos órfãos a cada troca. O
         * prefixo do workspace mantém o Storage espelhando a fronteira de
         * inquilino.
         *
         * O cliente administrativo é obrigatório aqui — o balde não tem policy
         * de RLS, e o cliente do usuário recebe "new row violates row-level
         * security policy". A autorização já aconteceu acima, via Prisma.
         */
        const chave = `${auth.member.workspaceId}/agents/${agentId}.${extension}`

        /**
         * `CLASSES.PUBLICO` e não clínico: o retrato do agente é da clínica,
         * não de paciente, e serve-se por URL direta e cacheável — passar isso
         * pelo Worker gastaria invocação para entregar byte que a borda entrega
         * melhor. A classificação é o que decide o balde; não há nome de bucket
         * escrito aqui.
         */
        let ref
        try {
            ref = await gravar(
                CLASSES.PUBLICO,
                chave,
                new Uint8Array(await file.arrayBuffer()),
                { contentType: file.type }
            )
        } catch (erro) {
            console.error('[AGENT_AVATAR] upload failed', erro)
            return NextResponse.json({ error: 'Falha no upload da imagem' }, { status: 500 })
        }

        /**
         * A coluna guarda **referência**, nunca endereço — e isto era um defeito
         * com sintoma exato.
         *
         * O que ficava gravado aqui era o retorno de `enderecoPara`. Sem
         * `PUBLIC_STORAGE_BASE_URL` configurado, `enderecoPara` **degrada para
         * URL assinada**, de validade máxima de 600 s. Então a imagem aparecia
         * ao salvar — a assinatura tinha acabado de nascer — e dez minutos
         * depois a mesma linha apontava para um 403: "a imagem fica quebrada na
         * tela de agentes e no perfil", que é o que o Andre viu.
         *
         * `lib/storage/tipos.ts` já avisava, nominalmente, que esta rota fazia
         * isso errado; `lib/midia.ts` já tinha a convenção pronta
         * (`ref:<classe>:<chave>`) e o conserto é passar a usá-la. O endereço
         * passa a ser cunhado na saída, a cada leitura — nasce válido e nunca
         * existe em repouso.
         *
         * Nada de `?v=`: a chave é fixa por agente, e era o parâmetro que furava
         * o cache do navegador depois de sobrescrever. Com endereço cunhado na
         * leitura, cada resposta já traz uma assinatura nova — ou, com domínio
         * público configurado, uma URL que o `updatedAt` do objeto invalida.
         */
        const agent = await prisma.agent.update({
            where: { id: agentId },
            data: { avatar: comoReferencia(ref) },
            select: { id: true, workspaceId: true, avatar: true },
        })

        // O cliente usa esta resposta como `src` do preview, então aqui vai o
        // endereço utilizável — não a referência que ficou no banco.
        return NextResponse.json({ id: agent.id, avatar: await enderecoDoAvatar(agent) })
    } catch (error) {
        console.error('[AGENT_AVATAR_POST]', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await getWorkspaceMember()
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status })
        }

        if (!MANAGER_ROLES.includes(auth.member.role)) {
            return NextResponse.json(
                { error: 'Você não tem permissão para alterar o agente' },
                { status: 403 }
            )
        }

        const { id: agentId } = await params

        if (!(await assertAgentAccess(agentId, auth.member.workspaceId))) {
            return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
        }

        // O arquivo fica no Storage; é um retrato por agente, sobrescrito no
        // próximo upload. Apagar o objeto só para limpar a referência trocaria
        // uma linha nula por uma chance de 404 em cache.
        const agent = await prisma.agent.update({
            where: { id: agentId },
            data: { avatar: null },
            select: { id: true, avatar: true },
        })

        return NextResponse.json(agent)
    } catch (error) {
        console.error('[AGENT_AVATAR_DELETE]', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}
