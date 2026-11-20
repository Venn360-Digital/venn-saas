import type { Prisma } from '@venn/db'

/**
 * Em que etapa do funil está a pessoa desta conversa.
 *
 * Existe num módulo próprio porque **três** lugares precisam concordar: o
 * cartão da lista, que mostra o nome da etapa; o filtro por etapa, que recorta
 * a lista; e a contagem que a barra mostrar algum dia. Quando o predicado é
 * reescrito em cada um, eles divergem no primeiro caso de borda — e aí a pessoa
 * filtra "Avaliação" e vê um cartão escrito "Proposta".
 *
 * ## Só negócio aberto, e é uma escolha
 *
 * `Deal.status` é `open | won | lost`, e aqui só `open` conta. "Etapa atual do
 * funil" é onde a pessoa está **agora**: um negócio ganho saiu do funil pela
 * porta da frente e um perdido pela de trás, e pintar a etapa em que ele
 * estava quando fechou diria que o paciente ainda está em negociação.
 *
 * Isto difere de propósito do `openDeal` da ficha da conversa, que traz o
 * último negócio **qualquer que seja o status** — ali o objetivo é não deixar o
 * painel em branco no instante em que alguém acabou de fechar, e permitir
 * reabrir pelo mesmo lugar. São perguntas diferentes: a ficha mostra "qual é o
 * negócio desta pessoa", o cartão mostra "onde ela está no funil".
 *
 * ## A ponte é o contato, não a conversa
 *
 * Não há FK entre `Deal` e `Conversation` — os dois apontam para `Contact`. É
 * por isso que a carga é em lote por `contactId`: uma consulta por conversa
 * seriam trinta consultas para pintar uma tela.
 */

/**
 * O recorte que define "negócio no funil". Um lugar só.
 *
 * **Do funil padrão.** Desde 20/11/2026 a unidade pode ter mais de um funil, e
 * o módulo de atendimento inteiro lê o padrão (PRODUCT.md §15): a pessoa com
 * negócio aberto só noutro funil aparece aqui "sem negócio aberto", que é a
 * verdade do ponto de vista do atendimento. `pipelineId` nulo — unidade sem
 * fase nenhuma — não casa com negócio nenhum, como antes.
 */
export function negocioNoFunil(workspaceId: string, pipelineId: string | null): Prisma.DealWhereInput {
    return { workspaceId, status: 'open', stage: { pipelineId: pipelineId ?? '' } }
}

export interface EtapaDoFunil {
    dealId: string
    stageId: string | null
    stageName: string | null
    stageColor: string | null
}

type DealParaEtapa = {
    id: string
    contactId: string | null
    stageId: string | null
    stage: { name: string; color: string | null } | null
}

/**
 * Os negócios em aberto, reduzidos a um por contato.
 *
 * Quando a pessoa tem dois negócios abertos, vale o **mais recente** — a mesma
 * regra do `orderBy` da ficha, para que os dois contem a mesma história. Quem
 * chama é responsável por ter ordenado por `createdAt: 'desc'`; a função
 * respeita a ordem que recebeu e fica com o primeiro de cada contato.
 */
export function etapaPorContato(negocios: DealParaEtapa[]): Map<string, EtapaDoFunil> {
    const mapa = new Map<string, EtapaDoFunil>()
    for (const negocio of negocios) {
        if (!negocio.contactId || mapa.has(negocio.contactId)) continue
        mapa.set(negocio.contactId, {
            dealId: negocio.id,
            stageId: negocio.stageId,
            stageName: negocio.stage?.name ?? null,
            stageColor: negocio.stage?.color ?? null,
        })
    }
    return mapa
}

/** O `select` que `etapaPorContato` espera. Junto dela para não dessincronizar. */
export const SELECT_ETAPA = {
    id: true,
    contactId: true,
    stageId: true,
    stage: { select: { name: true, color: true } },
} as const

/**
 * O recorte de conversa por etapa do funil.
 *
 * `all`/vazio não recorta; `none` é quem **não** tem negócio no funil; o resto
 * é o id de uma etapa.
 *
 * ## Uma divergência deliberada com o cartão, e por que ela é a certa
 *
 * O cartão mostra a etapa do negócio aberto **mais recente** (é `Map`, primeiro
 * vence). O filtro usa `some`: casa quem tem **algum** negócio aberto naquela
 * etapa. Com dois negócios abertos na mesma pessoa — raro, e legítimo quando a
 * clínica negocia dois tratamentos ao mesmo tempo — os dois discordam: o
 * cartão escreve a etapa de um, e o filtro encontra a pessoa pelo outro.
 *
 * Escolhido assim porque a pergunta que a pessoa faz ao filtrar é "quem está em
 * Proposta?", e quem tem uma proposta aberta está em Proposta mesmo que o
 * cadastro mais novo dele seja outro. O contrário — "de quem o negócio mais
 * recente está em Proposta" — esconderia da lista alguém que o funil de
 * Negócios mostra na coluna Proposta, e aí as duas telas é que divergiriam.
 */
export function recorteDeEtapa(
    workspaceId: string,
    etapa: string,
    pipelineId: string | null
): Prisma.ConversationWhereInput | null {
    if (!etapa || etapa === 'all') return null

    if (etapa === 'none') {
        return { contact: { deals: { none: negocioNoFunil(workspaceId, pipelineId) } } }
    }

    return { contact: { deals: { some: { ...negocioNoFunil(workspaceId, pipelineId), stageId: etapa } } } }
}

/**
 * O recorte de conversa por etiqueta.
 *
 * A **união** de `ConversationTag` e `ContactTag`, porque é a união que a tela
 * mostra — o chip no cartão sai dos dois vínculos fundidos. Filtrar por um só
 * lado faria a lista esconder conversa que exibe a etiqueta procurada, que é o
 * pior resultado possível de um filtro. Mesma fórmula do filtro de Pacientes.
 */
export function recorteDeEtiqueta(etiqueta: string): Prisma.ConversationWhereInput | null {
    if (!etiqueta || etiqueta === 'all') return null

    return {
        OR: [
            { tags: { some: { tagId: etiqueta } } },
            { contact: { tags: { some: { tagId: etiqueta } } } },
        ],
    }
}
