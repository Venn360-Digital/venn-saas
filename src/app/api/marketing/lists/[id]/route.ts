import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@venn/db'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { membrosForaDoCanal, removerMembros } from '@/lib/marketing/lists'
import { CANAIS_DE_CAMPANHA, type CanalDeCampanha } from '@/lib/marketing/apresentacao'

const filtroSchema = z.object({
    tagId: z.string().nullish(),
    originId: z.string().nullish(),
    dealStatus: z.string().nullish(),
    search: z.string().nullish(),
    excluirOptOut: z.boolean().optional(),
})

/**
 * O que a ficha da lista pode mudar — todos os atributos, não só o nome.
 *
 * Até aqui era `{ name }` e a tela chamava o diálogo de "Renomear lista": nome
 * era o único atributo editável de um objeto com quatro. Canal e filtro só
 * existiam no nascimento, e o jeito de corrigir um deles era apagar a lista e
 * refazer — perdendo o vínculo com as campanhas que a miravam.
 */
const patchSchema = z.object({
    name: z.string().min(1).optional(),
    channel: z.enum(CANAIS_DE_CAMPANHA).optional(),
    /**
     * O filtro é **informativo** numa lista estática: diz de onde ela veio, e
     * é o que a ficha repropõe quando alguém quer acrescentar mais gente pelo
     * mesmo critério. Salvá-lo NÃO repovoa a lista — repovoar é outro gesto,
     * com outro botão, porque substituir o conjunto é destrutivo.
     */
    filter: filtroSchema.nullish(),
})

async function ownedList(workspaceId: string, id: string) {
    return prisma.contactList.findFirst({ where: { id, workspaceId } })
}

/**
 * GET — o detalhe da lista.
 *
 * `?canalNovo=email` responde de quebra **quantos sairiam** se o canal fosse
 * trocado para aquele. É o número que a ficha mostra antes de salvar: trocar o
 * canal remove quem não tem o endereço do novo, e remoção que a pessoa não viu
 * chegando é remoção que ela vai descobrir pela contagem meses depois.
 *
 * Os membros vêm aqui só como amostra; a lista navegável e buscável é
 * `GET /membros`, paginada.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }
    const { id } = await params
    const lista = await ownedList(member.workspaceId, id)
    if (!lista) return new NextResponse('Lista não encontrada', { status: 404 })

    const total = await prisma.contactListMember.count({ where: { listId: id } })

    const canalNovo = _req.nextUrl.searchParams.get('canalNovo')
    const sairiam =
        canalNovo && (CANAIS_DE_CAMPANHA as readonly string[]).includes(canalNovo)
            ? (await membrosForaDoCanal(member.workspaceId, id, canalNovo as CanalDeCampanha))
                  .length
            : null

    return NextResponse.json({
        id: lista.id,
        name: lista.name,
        kind: lista.kind,
        channel: lista.channel,
        filter: lista.filter,
        memberCount: total,
        sairiamComOCanalNovo: sairiam,
    })
}

/**
 * PATCH — edita a lista: nome, canal e filtro.
 *
 * ## A troca de canal remove quem não serve ao novo
 *
 * Uma lista de WhatsApp que vira lista de e-mail leva consigo todo mundo sem
 * endereço. Esses contatos seriam congelados como destinatários e descartados no
 * disparo: a tela prometeria 2.000 de alcance e o relatório mostraria 700, sem
 * nada explicando a diferença.
 *
 * Então a troca **limpa** o que não serve, e devolve quantos saíram para a tela
 * dizer. Não é efeito colateral escondido: a ficha mostra o número antes de
 * salvar (`GET ?canalNovo=`), e aqui ele volta no corpo da resposta.
 *
 * O opt-out do canal antigo não é tocado — ver `removerMembros`. Sair de uma
 * lista não é pedir para não receber nada.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }
    const { id } = await params
    const atual = await ownedList(member.workspaceId, id)
    if (!atual) return new NextResponse('Lista não encontrada', { status: 404 })

    const corpo = patchSchema.safeParse(await request.json())
    if (!corpo.success) return NextResponse.json({ errors: corpo.error.issues }, { status: 400 })

    const dados: Prisma.ContactListUpdateInput = {}
    if (corpo.data.name !== undefined) dados.name = corpo.data.name
    if (corpo.data.channel !== undefined) dados.channel = corpo.data.channel
    if (corpo.data.filter !== undefined) {
        dados.filter =
            corpo.data.filter === null
                ? Prisma.DbNull
                : (corpo.data.filter as Prisma.InputJsonValue)
    }

    const trocouCanal =
        corpo.data.channel !== undefined && corpo.data.channel !== atual.channel

    const atualizada = await prisma.contactList.update({ where: { id }, data: dados })

    let removidos = 0
    if (trocouCanal) {
        const fora = await membrosForaDoCanal(
            member.workspaceId,
            id,
            corpo.data.channel as CanalDeCampanha
        )
        removidos = await removerMembros(id, fora)
    }

    const total = await prisma.contactListMember.count({ where: { listId: id } })

    return NextResponse.json({
        id: atualizada.id,
        name: atualizada.name,
        channel: atualizada.channel,
        memberCount: total,
        removidosPelaTrocaDeCanal: removidos,
    })
}

// DELETE — remove a lista (os membros caem por cascade; campanhas que a miravam
// perdem o vínculo, mas os destinatários já congelados permanecem).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }
    const { id } = await params
    if (!(await ownedList(member.workspaceId, id)))
        return new NextResponse('Lista não encontrada', { status: 404 })

    await prisma.contactList.delete({ where: { id } })
    return new NextResponse(null, { status: 204 })
}
