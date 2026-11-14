import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { postoNoFunilAMao } from '@/lib/funil/disparos'
import { lerGatilho } from '@/lib/funil/gatilho'

/**
 * Pôr um contato num funil à mão — o gatilho genérico.
 *
 * ## Por que recusa funil cujo gatilho não é `manual`
 *
 * Seria fácil deixar esta rota pôr gente em qualquer funil publicado: um botão
 * que "força" a entrada. Não é o mesmo produto. Um funil de boas-vindas que
 * dispara por `contato_criado` foi escrito contando com que a pessoa seja nova;
 * empurrar para dentro dele um paciente de dez anos manda a mensagem errada, e
 * quem apertou o botão não tem como saber disso olhando o nome do funil.
 *
 * O gatilho `manual` é a declaração de que este funil **espera** entrada por
 * decisão de alguém. É o que torna o botão seguro: o funil foi desenhado para
 * ele.
 *
 * ## O que esta rota NÃO contorna
 *
 * As três travas continuam inteiras, porque são de `talvezEntrarNoFunil` e não
 * desta rota: funil despublicado não recebe, teto de ativos vale, e os freios de
 * cada passo (humano assumiu, opt-out por canal, janela de 24h do WhatsApp)
 * seguem valendo passo a passo. Entrada manual escolhe **quem entra**, nunca
 * se o produto pode falar com a pessoa.
 */

const corpoSchema = z.object({ contactId: z.string().min(1) })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
        select: { id: true, name: true, status: true, trigger: true },
    })
    if (!funil) return new NextResponse('Funil não encontrado', { status: 404 })

    if (funil.status !== 'published') {
        return NextResponse.json(
            { error: 'Este funil está em rascunho. Publique-o antes de pôr alguém nele.' },
            { status: 409 }
        )
    }

    const gatilho = lerGatilho(funil.trigger)
    if (gatilho?.tipo !== 'manual') {
        return NextResponse.json(
            {
                error:
                    'Este funil tem outro gatilho e recebe gente por conta própria. Só funis com o gatilho "Só quando alguém puser o contato aqui" aceitam entrada manual.',
            },
            { status: 409 }
        )
    }

    /**
     * O contato é conferido aqui, e não dentro do disparo.
     *
     * `talvezEntrarNoFunil` nunca lança — é o desenho dele, porque os outros
     * pontos de disparo são rotas fazendo outra coisa. Então um `contactId` de
     * outra unidade sairia daqui como "ok, mas ninguém entrou", sem dizer por
     * quê. Nesta rota a entrada **é** o pedido, e recusar com motivo é o certo.
     */
    const contato = await prisma.contact.findFirst({
        where: { id: corpo.data.contactId, workspaceId: member.workspaceId },
        select: { id: true },
    })
    if (!contato) return new NextResponse('Contato não encontrado', { status: 404 })

    await postoNoFunilAMao(member.workspaceId, contato.id, funil.id)

    /**
     * O desfecho vem do banco, não do retorno do disparo.
     *
     * A passagem pode já existir (a pessoa foi posta ontem e ainda está
     * andando), e aí nada foi criado. Dizer "pronto, entrou" nesse caso faria a
     * tela mentir — e a pessoa apertaria de novo achando que não funcionou.
     */
    const passagem = await prisma.funnelRun.findFirst({
        where: { funnelId: funil.id, contactId: contato.id, status: 'running' },
        select: { id: true, startedAt: true },
    })

    return NextResponse.json({
        entrou: Boolean(passagem),
        runId: passagem?.id ?? null,
        desde: passagem?.startedAt?.toISOString() ?? null,
    })
}
