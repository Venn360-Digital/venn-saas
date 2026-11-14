import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { podePublicar } from '@/lib/funil/publicar'

/**
 * Publicar e despublicar — os dois atos que mudam o que o sistema **faz**.
 *
 * Separado do PUT de propósito. Salvar guarda um desenho; publicar liga um
 * automatismo que vai falar com pacientes sozinho, possivelmente por meses. São
 * decisões de peso diferente e merecem botão diferente.
 */

const corpoSchema = z.object({ publicar: z.boolean() })

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const corpo = corpoSchema.safeParse(await request.json())
    if (!corpo.success) return new NextResponse('Corpo inválido', { status: 400 })

    const funil = await prisma.funnel.findFirst({
        where: { id, workspaceId: member.workspaceId },
        select: {
            id: true,
            status: true,
            version: true,
            trigger: true,
            maxAtivos: true,
            steps: {
                orderBy: { order: 'asc' },
                select: { id: true, type: true, config: true, order: true, edges: true },
            },
        },
    })
    if (!funil) return new NextResponse('Funil não encontrado', { status: 404 })

    // ─────────────────────────── Despublicar ───────────────────────────

    if (!corpo.data.publicar) {
        /**
         * Despublicar **não** para as passagens aqui.
         *
         * Quem para é o motor, na volta seguinte de cada instância: o freio
         * `funil_despublicado` é lido a cada passo (ver `deveParar`), e aí a
         * passagem fica `stopped` com o motivo gravado.
         *
         * Parar daqui — um `updateMany` marcando tudo como `stopped` — seria
         * mentira em dois sentidos: as instâncias continuariam vivas e
         * acordariam de qualquer jeito, e a passagem apareceria parada antes de
         * de fato ter parado. Pior, uma instância que acordasse depois
         * encontraria a linha já `stopped` e o `updateMany` do desfecho não
         * pegaria nada (ele só toca `running`), então o motivo real nunca
         * sobrescreveria este.
         *
         * A espera é no máximo uma volta. Quem está dormindo um mês para de
         * verdade quando acordar, e nenhuma mensagem sai nesse meio-tempo
         * porque o freio é lido **antes** do passo.
         */
        await prisma.funnel.update({
            where: { id },
            data: { status: 'draft' },
        })

        const ativos = await prisma.funnelRun.count({ where: { funnelId: id, status: 'running' } })
        return NextResponse.json({
            status: 'draft',
            ativos,
            aviso:
                ativos > 0
                    ? `${ativos} pessoa(s) ainda estão dentro. Cada passagem para no próximo passo dela, com o motivo registrado — nenhuma mensagem sai até lá.`
                    : null,
        })
    }

    // ──────────────────────────── Publicar ────────────────────────────

    const recusa = podePublicar({
        trigger: funil.trigger,
        maxAtivos: funil.maxAtivos,
        passos: funil.steps,
    })

    if (recusa) {
        // `ciclo` vai junto para a tela destacar os nós — "existe um ciclo" não
        // ajuda quem desenhou noventa passos.
        return NextResponse.json({ error: recusa.motivo, ciclo: recusa.ciclo ?? null }, { status: 400 })
    }

    /**
     * `version` sobe a cada publicação, e quem já está dentro fica na dele.
     *
     * Republicar é um desenho novo para quem entrar daqui em diante. A versão é
     * gravada em `FunnelRun.version` na entrada, e é o registro de qual desenho
     * aquela pessoa percorreu — a tela usa isso para não prometer um caminho
     * que nunca existiu para ela.
     */
    const atualizado = await prisma.funnel.update({
        where: { id },
        data: {
            status: 'published',
            version: funil.status === 'published' ? funil.version + 1 : funil.version,
            publishedAt: new Date(),
        },
        select: { status: true, version: true, publishedAt: true },
    })

    return NextResponse.json({
        status: atualizado.status,
        version: atualizado.version,
        publishedAt: atualizado.publishedAt?.toISOString() ?? null,
    })
}
