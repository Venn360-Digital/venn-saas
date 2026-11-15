import prisma from '@venn/db/cliente'
import { vocab } from '../vocabulario'

/**
 * Confere que **id de relação vindo do navegador** pertence à clínica.
 *
 * ## O defeito que este arquivo existe para fechar
 *
 * O padrão das rotas de escrita está certo e é consistente: `findFirst` com
 * `workspaceId` para achar o registro, 404 quando não acha, e só então
 * `update`. Isso protege o **alvo** da escrita.
 *
 * O que ficava de fora era o **conteúdo** da escrita. `activities/[id]` e
 * `deals/[id]` gravavam `contactId`, `dealId`, `userId`, `professionalId`,
 * `productServiceId`, `originId` e `mediaId` crus do corpo. A atividade era da
 * clínica certa; o paciente apontado por ela, não necessariamente.
 *
 * E não era só escrita: o `include` da resposta devolve
 * `contact: { id, name, phone }`. Apontar a própria atividade para um
 * `contactId` de outra clínica fazia a resposta **devolver o nome e o telefone
 * daquele paciente** — e `syncActivityToGoogleCalendar`, logo abaixo, empurrava
 * o dado para o Google Calendar da clínica atacante.
 *
 * ## Por que um helper e não um `if` em cada rota
 *
 * Porque são sete campos em quatro rotas, e a forma de conferir não é a mesma
 * para todos (ver `userId` abaixo). Espalhado, o próximo campo novo entra sem
 * conferência — foi exatamente assim que estes entraram. `scripts/check-tenant.ts`
 * prova este arquivo, e é a prova que `01-compatibility.md` prometeu quando o
 * RLS saiu e nunca foi escrita.
 *
 * ## O que este helper NÃO faz
 *
 * Não filtra por `isActive` ao conferir `userId`. Atribuir trabalho a um membro
 * desativado é discutível, mas é decisão de produto e mudá-la aqui quebraria
 * telas que listam quem já respondia por um registro. O padrão seguido é o de
 * `professionals/route.ts`, que confere participação e não atividade.
 */

export type CampoDeRelacao =
    | 'contactId'
    | 'dealId'
    | 'userId'
    | 'professionalId'
    | 'productServiceId'
    | 'originId'
    | 'mediaId'
    | 'stageId'
    | 'outcomeReasonId'
    | 'closedStageId'
    | 'tagIds'

/** O nome que vai na mensagem de erro — o campo, não o modelo. */
/**
 * Função memoizada, e não constante: o texto lê o vocabulário, e `BRAND()` é
 * fail-fast. Constante de módulo é avaliada quando a Cloudflare VALIDA o
 * script — sem requisição e sem marca registrada —, e a publicação reprova com
 * `MarcaNaoRegistradaError`. A forma que já reprovou cinco publicações.
 */
let rotuloCache: Record<CampoDeRelacao, string> | null = null
function ROTULO(): Record<CampoDeRelacao, string> {
    if (rotuloCache === null) rotuloCache = {
    contactId: `${vocab().pessoa}`,
    dealId: 'negócio',
    userId: 'usuário',
    professionalId: `${vocab().profissional}`,
    productServiceId: 'serviço',
    originId: 'origem',
    mediaId: 'mídia',
    stageId: 'fase',
    outcomeReasonId: 'motivo',
    closedStageId: 'fase de fechamento',
    tagIds: 'etiqueta',
}
    return rotuloCache
}

/**
 * Quantos dos `ids` pertencem a esta clínica.
 *
 * `switch` explícito e não um mapa de delegados do Prisma: tipar delegado
 * genérico aqui custa `any`, e este é o último arquivo onde vale pagar esse
 * preço. Verboso de propósito — dá para ler cada linha e conferir que o
 * `workspaceId` está lá.
 */
async function quantosPertencem(
    workspaceId: string,
    campo: CampoDeRelacao,
    ids: string[]
): Promise<number> {
    const where = { workspaceId, id: { in: ids } }

    switch (campo) {
        case 'contactId':
            return prisma.contact.count({ where })
        case 'dealId':
            return prisma.deal.count({ where })
        case 'professionalId':
            return prisma.professional.count({ where })
        case 'productServiceId':
            return prisma.productService.count({ where })
        case 'originId':
            return prisma.origin.count({ where })
        case 'mediaId':
            return prisma.media.count({ where })
        case 'stageId':
        case 'closedStageId':
            return prisma.pipelineStage.count({ where })
        case 'outcomeReasonId':
            return prisma.dealOutcomeReason.count({ where })
        case 'tagIds':
            return prisma.tag.count({ where })

        case 'userId': {
            /**
             * `User` não tem `workspaceId` — a ligação com a clínica é a
             * participação. Mesma consulta que `professionals/route.ts:81-86`.
             *
             * `distinct` porque a contagem tem de ser de **usuários**, não de
             * linhas de participação: se um dia alguém tiver duas, a contagem
             * crua passaria com um id a menos conferido.
             */
            const membros = await prisma.workspaceUser.findMany({
                where: { workspaceId, userId: { in: ids } },
                select: { userId: true },
                distinct: ['userId'],
            })
            return membros.length
        }
    }
}

export interface RelacaoRecusada {
    campo: CampoDeRelacao
    rotulo: string
    /** Mensagem pronta para a resposta HTTP, sem revelar o que existe na outra clínica. */
    mensagem: string
}

/**
 * Confere todos os campos de uma vez. Devolve `null` quando está tudo bem.
 *
 * `null` ou `undefined` num campo significa "não mexa" ou "limpe", e nos dois
 * casos não há id para conferir. String vazia idem.
 *
 * A mensagem de erro é sempre "não encontrado", nunca "pertence a outra
 * clínica": a segunda confirma ao atacante que o id existe, o que é
 * exatamente o oráculo que a conferência quer fechar.
 */
export async function conferirRelacoes(
    workspaceId: string,
    valores: Partial<Record<CampoDeRelacao, string | string[] | null | undefined>>
): Promise<RelacaoRecusada | null> {
    for (const [chave, valor] of Object.entries(valores)) {
        const campo = chave as CampoDeRelacao

        const ids = (Array.isArray(valor) ? valor : [valor])
            .filter((v): v is string => typeof v === 'string' && v.length > 0)

        if (ids.length === 0) continue

        // Duplicata no corpo não deve fazer a contagem falhar sozinha.
        const unicos = [...new Set(ids)]

        const achados = await quantosPertencem(workspaceId, campo, unicos)
        if (achados !== unicos.length) {
            return {
                campo,
                rotulo: ROTULO()[campo],
                mensagem: `${ROTULO()[campo]} não encontrado`,
            }
        }
    }

    return null
}
