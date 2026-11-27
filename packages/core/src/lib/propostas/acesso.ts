import 'server-only'

import prisma from '@venn/db/cliente'
import type { Prisma } from '@venn/db'

import { dealScope, type WorkspaceMember } from '../auth/workspace'

/**
 * Quem vê qual documento.
 *
 * ## A regra, numa linha: a proposta herda a visibilidade do negócio
 *
 * Não há um eixo novo de permissão aqui, e isso é decisão. Documento tem dono
 * (`Proposal.userId`), mas recortar por ele criaria o caso em que o atendente
 * vê o negócio e não vê a proposta dele — ou pior, o contrário: enxerga uma
 * proposta cujo negócio está fora do recorte dele, e com ela o valor que outra
 * pessoa está negociando.
 *
 * Então o recorte é `dealScope(membro)` aplicado através da relação. Uma regra
 * de visibilidade a menos para dessincronizar, e a tela de Negócios e a de
 * Propostas nunca discordam.
 *
 * ## Por que mora aqui e não em cada rota
 *
 * São nove rotas, e `where` copiado nove vezes é `where` que divergiu em oito.
 * `lint-workspace.mjs` já reprova resolução de workspace fora de
 * `lib/auth/workspace.ts` pela mesma razão.
 */

/** O `where` de uma proposta visível a este membro, dentro da unidade dele. */
export function escopoDaProposta(
    membro: Pick<WorkspaceMember, 'role' | 'userId' | 'departmentIds' | 'workspaceId'>
): Prisma.ProposalWhereInput {
    return {
        workspaceId: membro.workspaceId,
        // Exclusão lógica: documento apagado não aparece em lista nenhuma, mas
        // continua explicando o valor que entrou no funil.
        deletedAt: null,
        deal: dealScope(membro),
    }
}

/** O que as rotas precisam saber de uma proposta para decidir. */
export interface PropostaParaRota {
    id: string
    workspaceId: string
    dealId: string
    kind: string
    number: number
    currency: string
    currentRevisionId: string | null
}

/**
 * Encontra a proposta, já recortada.
 *
 * Devolve `null` quando ela não existe, está apagada, é de outra unidade **ou**
 * está fora do recorte do membro — os quatro casos de propósito
 * indistinguíveis. A rota responde 404 para todos: um 403 no último caso
 * confirmaria que a proposta existe, e com ela que aquele negócio existe.
 */
export async function propostaVisivel(
    membro: Pick<WorkspaceMember, 'role' | 'userId' | 'departmentIds' | 'workspaceId'>,
    propostaId: string
): Promise<PropostaParaRota | null> {
    return prisma.proposal.findFirst({
        where: { ...escopoDaProposta(membro), id: propostaId },
        select: {
            id: true,
            workspaceId: true,
            dealId: true,
            kind: true,
            number: true,
            currency: true,
            currentRevisionId: true,
        },
    })
}

/** O que as rotas precisam saber de uma revisão. */
export interface RevisaoParaRota {
    id: string
    proposalId: string
    version: number
    status: string
}

/**
 * Encontra uma revisão por proposta e número de versão, já recortada.
 *
 * A versão vem na URL como número, e não o id da revisão: `/propostas/x/revisoes/2`
 * é endereço que uma pessoa lê e digita, e o id é `cmh3k2j0x0001`. O
 * `@@unique([proposalId, version])` garante que o par resolve uma linha só.
 */
export async function revisaoVisivel(
    membro: Pick<WorkspaceMember, 'role' | 'userId' | 'departmentIds' | 'workspaceId'>,
    propostaId: string,
    versao: number
): Promise<RevisaoParaRota | null> {
    return prisma.proposalRevision.findFirst({
        where: {
            version: versao,
            proposalId: propostaId,
            // O recorte vai pela proposta, não por uma cópia da regra aqui.
            proposal: { ...escopoDaProposta(membro), id: propostaId },
        },
        select: { id: true, proposalId: true, version: true, status: true },
    })
}
