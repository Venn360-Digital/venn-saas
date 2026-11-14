import { NextRequest, NextResponse } from 'next/server'

import {
    CACHE_DO_RETRATO,
    CACHE_DO_SEM_RETRATO,
    bytesDoEmbutido,
    formaDoRetrato,
} from '@venn/core/lib/retratos'
import { enderecoDaMidia } from '@venn/core/lib/midia'
import { getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import prisma from '@venn/db/cliente'

/**
 * O retrato de um usuário ou de um agente, servido por endereço estável.
 *
 * Existe para que o cartão da conversa possa mostrar foto sem que a lista
 * carregue os bytes dela — ver `lib/retratos.ts` para a medição que motivou
 * isto (o retrato do Andre tem 277 KB de base64 na coluna, e a lista repetia
 * por cartão).
 *
 * ## Autorizada, e por isso `private`
 *
 * Retrato de gente da clínica não é público. A guarda é a mesma do resto: quem
 * pede tem de ser membro de alguma unidade, e o alvo tem de estar **na mesma
 * unidade** de quem pede. Daí o cache ser `private` — um cache compartilhado
 * guardaria a foto de uma clínica para servir a outra.
 *
 * ## O 404 é um retrato ausente, não um erro
 *
 * Quem não tem foto devolve 404 com corpo vazio **e cabeçalho de cache**. É o
 * caso normal, não a corrida: a lista deixou de decidir isso (ver
 * `enderecoDoRetrato`), porque decidir exigia trazer a foto inteira do banco
 * para produzir um booleano. O componente `Retrato` desenha o nome primeiro e
 * só revela a imagem quando ela carrega, então o 404 não aparece na tela.
 */

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sujeito: string; id: string }> }
) {
    const { sujeito, id } = await params

    if (sujeito !== 'usuario' && sujeito !== 'agente') {
        return new NextResponse(null, { status: 404 })
    }

    const auth = await getWorkspaceMember()
    if (!auth.ok) return new NextResponse(null, { status: auth.status })
    const workspaceId = auth.member.workspaceId

    /**
     * A guarda, por consulta e não por comparação depois.
     *
     * Para usuário é `workspaceUser` com os dois ids: pedir o retrato de alguém
     * exige que ele seja da unidade de quem pede. Para agente é o próprio
     * `workspaceId` da linha. Nos dois casos o alvo que não passa é
     * indistinguível do que não existe, e é assim que se evita usar esta rota
     * para descobrir quem trabalha em qual clínica.
     */
    let avatar: string | null = null
    let atualizadoEm: Date | null = null

    if (sujeito === 'usuario') {
        const vinculo = await prisma.workspaceUser.findFirst({
            where: { workspaceId, userId: id },
            select: { user: { select: { avatar: true, updatedAt: true } } },
        })
        avatar = vinculo?.user.avatar ?? null
        atualizadoEm = vinculo?.user.updatedAt ?? null
    } else {
        const agente = await prisma.agent.findFirst({
            where: { id, workspaceId },
            select: { avatar: true, updatedAt: true },
        })
        avatar = agente?.avatar ?? null
        atualizadoEm = agente?.updatedAt ?? null
    }

    /**
     * Sem foto é 404 **com cabeçalho de cache** — e isso é o que permite às
     * listas pararem de pedir a coluna ao banco.
     *
     * Enquanto a lista decidia "tem foto?" do lado dela, toda consulta tinha de
     * trazer `avatar` — a foto inteira — para produzir um booleano. Agora quem
     * decide é esta rota, que precisa dos bytes de todo jeito; e o cache de uma
     * hora impede que a mudança troque 275 kB de banco por uma requisição por
     * pessoa sem foto a cada carregamento.
     *
     * Uma hora, e não um ano como o do retrato que existe: quem põe foto hoje
     * quer vê-la hoje.
     */
    const forma = formaDoRetrato(avatar)
    if (forma.tipo === 'nenhum') {
        return new NextResponse(null, {
            status: 404,
            headers: { 'Cache-Control': CACHE_DO_SEM_RETRATO },
        })
    }

    /**
     * O `ETag` sai do `updatedAt`, o mesmo valor que vira `v` no endereço.
     *
     * Com `immutable` o navegador nem revalida, mas o `ETag` serve a quem
     * revalida de propósito — um recarregamento forçado — e devolve 304 em vez
     * de reenviar a imagem.
     */
    const etag = `"${(atualizadoEm?.getTime() ?? 0).toString(36)}"`
    if (request.headers.get('if-none-match') === etag) {
        return new NextResponse(null, { status: 304, headers: { ETag: etag } })
    }

    if (forma.tipo === 'embutido') {
        const bytes = bytesDoEmbutido(forma.base64)
        return new NextResponse(bytes as unknown as BodyInit, {
            headers: {
                'Content-Type': forma.mime,
                'Content-Length': String(bytes.byteLength),
                'Cache-Control': CACHE_DO_RETRATO,
                ETag: etag,
            },
        })
    }

    /**
     * O retrato de acervo é **buscado aqui**, não redirecionado.
     *
     * Redirecionar entregaria ao navegador a URL assinada, que vale 600 s
     * (`VALIDADE_MAXIMA_SEGUNDOS`) — e numa coluna de conversas que fica aberta
     * a manhã inteira as fotos sumiriam em dez minutos. Buscando aqui, a
     * validade da assinatura é problema de uma requisição só, e o que o
     * navegador guarda é **este** endereço, que não expira porque carrega `v`.
     */
    const endereco = await enderecoDaMidia(forma.valor)
    if (!endereco) return new NextResponse(null, { status: 404 })

    const resposta = await fetch(endereco).catch(() => null)
    if (!resposta?.ok || !resposta.body) return new NextResponse(null, { status: 404 })

    const mime = resposta.headers.get('content-type') ?? 'image/png'
    // Não confiar no `content-type` do acervo para servir qualquer coisa: se o
    // objeto não é imagem conhecida, não vira resposta nossa.
    if (!mime.startsWith('image/') || mime.includes('svg')) {
        return new NextResponse(null, { status: 404 })
    }

    return new NextResponse(resposta.body, {
        headers: {
            'Content-Type': mime,
            'Cache-Control': CACHE_DO_RETRATO,
            ETag: etag,
        },
    })
}
