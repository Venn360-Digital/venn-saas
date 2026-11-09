import 'server-only'
import { talvezEntrarNoFunil } from './entrar'

/**
 * Os pontos de disparo do funil, um por tipo de gatilho.
 *
 * Existem como funções nomeadas, e não como uma chamada genérica espalhada, por
 * dois motivos:
 *
 * 1. **Para `npm run check:gatilhos` poder cobrar.** Tipo de gatilho declarado
 *    em `gatilho.ts` e nunca disparado é a falha mais silenciosa que esta
 *    feature pode ter: o funil fica publicado, bonito na tela, e ninguém entra.
 *    Sem mensagem de erro, sem log, sem nada. O verificador exige que cada tipo
 *    tenha pelo menos um disparo e pelo menos um ponto de chamada.
 * 2. **Para a decisão de ONDE não disparar ficar escrita.** Ver abaixo.
 *
 * ## Onde o funil deliberadamente NÃO entra
 *
 * **Importação em massa de contatos** (`/api/contacts/import`). Um CSV de 5.000
 * pacientes dispararia 5.000 funis de boas-vindas, e a clínica mandaria "seja
 * bem-vindo!" para gente que é paciente dela há dez anos. É o pior desfecho
 * possível do primeiro dia desta feature: milhares de e-mails errados, reclamação
 * em massa, e a reputação do domínio do cliente queimada antes de a primeira
 * campanha de verdade sair.
 *
 * Importação é **migração de acervo**, não chegada de gente nova. Quem quer
 * nutrir a base importada aplica uma etiqueta depois, de propósito, e aí o
 * gatilho de etiqueta pega — com a pessoa tendo escolhido.
 *
 * **O serviço de conversa** (`trabalhos/servicos/conversation.ts`) também não
 * dispara: ele cria contato e negócio dentro do caminho de mensagem recebida, e
 * esse caminho já tem o agente de IA respondendo. Funil por cima disso falaria
 * junto com o agente, na mesma conversa.
 */

/** Uma etiqueta foi aplicada a um contato. */
export async function etiquetaAplicada(
    workspaceId: string,
    contactId: string,
    tagId: string
): Promise<void> {
    await talvezEntrarNoFunil({ tipo: 'etiqueta_aplicada', workspaceId, contactId, alvo: tagId })
}

/**
 * Várias etiquetas de uma vez — o caso da tela, que salva o conjunto.
 *
 * Sequencial e não `Promise.all`: cada disparo lê os funis publicados da unidade
 * e pode criar passagem, e paralelizar aqui multiplicaria conexões ao Neon num
 * caminho que já está dentro de uma requisição. São poucas etiquetas por vez.
 */
export async function etiquetasAplicadas(
    workspaceId: string,
    contactId: string,
    tagIds: readonly string[]
): Promise<void> {
    for (const tagId of tagIds) {
        await etiquetaAplicada(workspaceId, contactId, tagId)
    }
}

/** Um negócio do contato entrou numa etapa. */
export async function negocioEntrouNaEtapa(
    workspaceId: string,
    contactId: string,
    stageId: string
): Promise<void> {
    await talvezEntrarNoFunil({ tipo: 'etapa_do_negocio', workspaceId, contactId, alvo: stageId })
}

/**
 * Contatos entraram numa lista.
 *
 * Lista recebe gente em lote por construção (a tela adiciona por filtro), e aí
 * o teto `maxAtivos` do funil é a rédea — não um limite aqui. Mas o laço é
 * sequencial pelo mesmo motivo do de etiquetas, e um lote grande numa lista é
 * exatamente o caso em que o teto do funil tem de estar configurado.
 */
export async function contatosEntraramNaLista(
    workspaceId: string,
    listId: string,
    contactIds: readonly string[]
): Promise<void> {
    for (const contactId of contactIds) {
        await talvezEntrarNoFunil({
            tipo: 'entrou_na_lista',
            workspaceId,
            contactId,
            alvo: listId,
        })
    }
}

/**
 * Um contato foi criado — **um**, por gente ou por lead chegando.
 *
 * Nunca chamado pela importação em massa. Ver o cabeçalho.
 */
export async function contatoCriado(workspaceId: string, contactId: string): Promise<void> {
    await talvezEntrarNoFunil({ tipo: 'contato_criado', workspaceId, contactId })
}
