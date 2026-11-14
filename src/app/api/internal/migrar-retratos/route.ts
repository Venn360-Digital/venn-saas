import { NextRequest, NextResponse } from 'next/server'

import { APP } from '@/config/app.config'
import { formaDoRetrato, guardarRetrato } from '@/lib/retratos'
import { igualEmTempoConstante } from '@/lib/comparacao'
import prisma from '@venn/db/cliente'

/**
 * Move os retratos que estão **dentro da coluna** para o acervo.
 *
 * ## O que ela conserta
 *
 * `users.avatar` guardava `data:image/png;base64,…` — a foto inteira em texto.
 * Medido na produção de origem antes de escrever: **275 kB em dois usuários**,
 * um deles com 277.026 bytes, e isso era ~40% da tabela `users`. Anexo de
 * conversa e foto de contato já iam para o acervo; o perfil ficou para trás.
 *
 * A **fonte** já foi consertada (`api/account/profile` grava referência agora).
 * Esta rota é a limpeza do que ficou — e tinha de vir depois, senão seria
 * esteira: cada pessoa que trocasse a foto repunha um data URI.
 *
 * ## Por que é rota, e não script
 *
 * Gravar no acervo exige as credenciais do R2, que são `secret_text` no Worker
 * — ilegíveis por API, e de propósito. Um script local precisaria que elas
 * saíssem do Cloudflare para a máquina de alguém. Rodando aqui, elas não saem
 * de onde estão, e a mesma rota serve os três apps.
 *
 * Mesmo portão da retranscrição: `x-identity-token`, comparado em tempo
 * constante.
 *
 * ## O que ela NÃO faz
 *
 * Não apaga nada. Troca o valor da coluna pela referência, e os bytes passam a
 * existir nos dois lugares até o próximo `UPDATE` sobrescrever a coluna — que é
 * exatamente o que acontece aqui. Se o acervo recusar no meio, as pessoas já
 * convertidas ficam convertidas e as outras ficam como estavam: nenhum estado
 * intermediário quebra a tela, porque `formaDoRetrato` entende as duas formas.
 */

/** Teto por chamada. Converter é upload: melhor várias passadas que um timeout. */
const TETO_PADRAO = 25

export async function POST(req: NextRequest) {
    if (!igualEmTempoConstante(req.headers.get('x-identity-token') ?? '', APP.identityToken)) {
        return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const teto = Math.min(Number(searchParams.get('limite')) || TETO_PADRAO, 100)

    /**
     * `startsWith('data:')` no banco, não `formaDoRetrato` em memória.
     *
     * Trazer a coluna de todo mundo para filtrar aqui seria arrastar os mesmos
     * bytes que esta rota existe para tirar do caminho. O filtro grosso é do
     * Postgres; o fino (MIME aceito, SVG recusado) é da função pura, depois.
     */
    const candidatos = await prisma.user.findMany({
        where: { avatar: { startsWith: 'data:' } },
        select: {
            id: true,
            avatar: true,
            // A unidade entra na chave do arquivo. Quem está em mais de uma: a
            // primeira serve — o retrato é da pessoa, não da unidade, e a chave
            // só precisa ser estável.
            workspaces: { select: { workspaceId: true }, take: 1 },
        },
        take: teto,
    })

    const convertidos: string[] = []
    const recusados: { userId: string; motivo: string }[] = []

    for (const u of candidatos) {
        const workspaceId = u.workspaces[0]?.workspaceId
        if (!workspaceId) {
            // Pessoa sem vínculo nenhum: não há unidade para a chave. Deixar
            // como está é melhor que inventar um prefixo que ninguém acha.
            recusados.push({ userId: u.id, motivo: 'sem unidade' })
            continue
        }

        const forma = formaDoRetrato(u.avatar)
        if (forma.tipo !== 'embutido') {
            // Chega aqui o que o `startsWith` pegou e a função pura recusou —
            // um `data:image/svg+xml`, por exemplo, que não servimos.
            recusados.push({ userId: u.id, motivo: `forma ${forma.tipo}` })
            continue
        }

        const guardado = await guardarRetrato({
            workspaceId,
            sujeito: 'usuario',
            sujeitoId: u.id,
            valor: u.avatar!,
        })
        if (!guardado) {
            recusados.push({ userId: u.id, motivo: 'acervo recusou' })
            continue
        }

        await prisma.user.update({
            where: { id: u.id },
            data: { avatar: guardado.referencia },
        })
        convertidos.push(u.id)
    }

    /**
     * `restam` é lido de novo, e não calculado: se duas chamadas correrem
     * juntas, o número calculado estaria errado e é ele que diz se há mais
     * passada a fazer.
     */
    const restam = await prisma.user.count({ where: { avatar: { startsWith: 'data:' } } })

    return NextResponse.json({
        convertidos: convertidos.length,
        recusados,
        restam,
        /** Quando `restam > 0` e nada foi convertido, repetir não resolve. */
        chameDeNovo: restam > 0 && convertidos.length > 0,
    })
}
