import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import {
    dominioOrganizacional,
    pareceDmarc,
    registroDmarcSugerido,
    txtsDaRespostaDoh,
} from '@venn/core/lib/marketing/dmarc'

/**
 * O DMARC do domínio já está publicado?
 *
 * ## Por que uma rota, e não uma coluna
 *
 * O estado não é nosso: ele vive na zona do cliente e pode mudar em qualquer
 * minuto, sem nos avisar. Guardado em coluna, ele envelheceria em silêncio — a
 * tela diria "DMARC publicado" por semanas depois de alguém tirar o registro
 * durante uma migração de DNS, que é precisamente quando a campanha começaria a
 * cair e ninguém olharia aqui. Consulta ao vivo, a cada vez que a ficha abre:
 * mais barato que a migração, e nunca desatualizado.
 *
 * ## Por que a consulta é do servidor
 *
 * Não existe API de DNS no navegador, e nossa `connect-src` é `'self'` — um
 * fetch do cliente para um resolvedor morreria em silêncio no CSP. O Worker fala
 * com a rede sem essa restrição.
 *
 * ## A herança é consultada, não presumida
 *
 * `_dmarc.mkt.exemplo.com.br` primeiro; se não houver, `_dmarc.exemplo.com.br`,
 * porque o DMARC do organizacional cobre o subdomínio (RFC 7489 §6.6.3). Sem a
 * segunda consulta a tela pediria um registro que já existe — e publicá-lo
 * poderia *afrouxar* a política da raiz, já que a do subdomínio prevalece.
 */

const RESOLVEDOR = 'https://cloudflare-dns.com/dns-query'

/** Consulta um TXT. Nunca lança: devolve `null` quando a rede falha. */
async function txts(nome: string): Promise<string[] | null> {
    try {
        const res = await fetch(
            `${RESOLVEDOR}?name=${encodeURIComponent(nome)}&type=TXT`,
            { headers: { Accept: 'application/dns-json' } }
        )
        if (!res.ok) return null
        return txtsDaRespostaDoh(await res.json())
    } catch {
        return null
    }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const remetente = await prisma.emailSender.findFirst({
        where: { id, workspaceId: member.workspaceId },
        select: { domain: true },
    })
    if (!remetente) return new NextResponse('Domínio não encontrado', { status: 404 })

    const nomes = [`_dmarc.${remetente.domain}`]
    const pai = dominioOrganizacional(remetente.domain)
    if (pai) nomes.push(`_dmarc.${pai}`)

    let indisponivel = false
    for (const nome of nomes) {
        const encontrados = await txts(nome)
        if (encontrados === null) {
            indisponivel = true
            continue
        }
        const politica = encontrados.find(pareceDmarc)
        if (politica) {
            return NextResponse.json({
                encontrado: true,
                onde: nome,
                /**
                 * Herdado quando a política está no pai: a tela diz isso em vez
                 * de só mostrar um visto, porque "o DMARC está no domínio raiz"
                 * e "o DMARC está neste subdomínio" levam a decisões diferentes
                 * quando alguém for endurecer a política depois.
                 */
                herdado: nome !== nomes[0],
                registro: politica,
            })
        }
    }

    return NextResponse.json({
        encontrado: false,
        /**
         * `indisponivel` separa "não tem" de "não deu para olhar". Sem essa
         * distinção a tela mandaria publicar um registro que talvez já exista,
         * por causa de uma falha de rede de dois segundos.
         */
        indisponivel,
        sugestao: registroDmarcSugerido(remetente.domain),
    })
}
