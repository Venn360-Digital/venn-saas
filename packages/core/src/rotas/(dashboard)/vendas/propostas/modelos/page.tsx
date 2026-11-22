import prisma from '@venn/db/cliente'
import { membroOuLogin } from '@venn/core/lib/indice-servidor'
import { hasEditorRole } from '@venn/core/lib/auth/workspace'
import { redirect } from 'next/navigation'

import { ModelosClient } from './ModelosClient'
import type { ModeloItem } from './dados'

/**
 * Os modelos de documento da unidade.
 *
 * ## Por que esta tela existe, e por que só agora
 *
 * O modelo nasceu no banco e na API em 21/11/2026, **sem tela**: proposta sem
 * modelo abre no corpo padrão do render, e isso cobre o primeiro documento de
 * quem acabou de entrar. O que não cobria era mudar a saudação — para isso o
 * caminho era `PATCH` à mão. A homologação cobrou, e com razão: o texto que o
 * cliente lê é a parte do produto que a organização mais quer na própria voz.
 *
 * ## Configuração, não operação
 *
 * `hasEditorRole` e não `escopoDaProposta`: o modelo vale para a unidade
 * inteira, então não é de um responsável nem de um departamento — é
 * configuração compartilhada, e a mesma regra que a tela de etapas aplica.
 * Atendente não entra. Esconder do menu não é autorização: o portão está aqui e
 * nas rotas, não no `nav.ts`.
 *
 * Sem paginação de propósito: são três por unidade no estado semeado, e uma
 * organização com dezenas de modelos é um problema que ninguém tem — quando
 * tiver, `lib/indice-servidor` já resolve.
 */
export default async function ModelosDeDocumentoPage() {
    const membro = await membroOuLogin()
    if (!hasEditorRole(membro.role)) redirect('/vendas/propostas')

    const linhas = await prisma.proposalTemplate.findMany({
        where: { workspaceId: membro.workspaceId },
        // A mesma ordem do `GET /api/propostas/templates`: o padrão do tipo
        // primeiro, porque é o que a pessoa procura.
        orderBy: [{ kind: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
        select: {
            id: true,
            name: true,
            kind: true,
            body: true,
            isDefault: true,
            isActive: true,
            _count: { select: { proposals: true } },
        },
    })

    const modelos: ModeloItem[] = linhas.map((m) => ({
        id: m.id,
        name: m.name,
        kind: m.kind,
        body: m.body,
        isDefault: m.isDefault,
        isActive: m.isActive,
        emUso: m._count.proposals,
    }))

    return <ModelosClient inicial={modelos} />
}
