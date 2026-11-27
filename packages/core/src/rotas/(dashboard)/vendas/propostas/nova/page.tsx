import prisma from '@venn/db/cliente'
import { dealScope } from '@venn/core/lib/auth/workspace'
import { membroOuLogin } from '@venn/core/lib/indice-servidor'
import { secoesSchema } from '@venn/core/lib/propostas/secoes'

import { NovaClient } from './NovaClient'

/**
 * Começar um documento — as três faixas, numa coluna, sem diálogo.
 *
 * Substitui o `NovaPropostaDialog` da v1 (tipo, busca de negócio, título,
 * Criar), que era o primeiro dos quatro diálogos do caminho antigo. Daqui a
 * pessoa sai direto no compositor.
 *
 * `?negocio=<id>` preenche a faixa "para quem" — é o que a ficha do negócio
 * passa quando o atalho de um clique não serve (negócio fechado, por exemplo).
 * O recorte é `dealScope`: negócio que o membro não vê não entra nem pela URL.
 */
export default async function NovaPropostaPage({
    searchParams,
}: {
    searchParams: Promise<{ negocio?: string }>
}) {
    const membro = await membroOuLogin()
    const { negocio: negocioId } = await searchParams

    const [modelos, negocio] = await Promise.all([
        prisma.proposalTemplate.findMany({
            where: { workspaceId: membro.workspaceId, isActive: true },
            orderBy: [{ kind: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
            select: { id: true, name: true, kind: true, isDefault: true, sections: true, body: true },
        }),
        negocioId
            ? prisma.deal.findFirst({
                  where: { id: negocioId, workspaceId: membro.workspaceId, ...dealScope(membro) },
                  select: { id: true, title: true, contact: { select: { name: true, phone: true, email: true } } },
              })
            : null,
    ])

    return (
        <NovaClient
            modelos={modelos.map((m) => {
                const secoes = secoesSchema.safeParse(m.sections)
                return {
                    id: m.id,
                    name: m.name,
                    kind: m.kind,
                    isDefault: m.isDefault,
                    // Quantas seções, para o cartão dizer "5 seções" — e "texto
                    // da v1" quando ainda não foi convertido.
                    secoes: secoes.success ? secoes.data.length : m.body ? null : 0,
                }
            })}
            negocio={
                negocio
                    ? {
                          id: negocio.id,
                          title: negocio.title,
                          contato: negocio.contact?.name ?? null,
                          detalhe: [negocio.contact?.phone, negocio.contact?.email].filter(Boolean).join(' · ') || null,
                      }
                    : null
            }
        />
    )
}
