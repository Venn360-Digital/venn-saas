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
 *
 * ## Onde ele passou a entrar: o formulário de captura
 *
 * O envio de um formulário dispara dois destes pontos — `contatoCriado` quando
 * a ficha é nova, e `etiquetasAplicadas` para a etiqueta que a ficha ainda não
 * tinha (decisão do Andre em 20/11/2026). É o oposto da importação em massa, e
 * pela mesma régua: o formulário é **uma pessoa chegando agora**, por vontade
 * dela, e quem escolhe o critério é o cliente, marcando a etiqueta no
 * formulário. A etiqueta que a ficha já tinha não dispara: "aplicada" tem de
 * querer dizer aplicada, senão o funil de nutrição recomeçaria a cada visita.
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

/**
 * Um negócio foi fechado — ganho ou perdido.
 *
 * ## Por que é um fechamento e não uma etapa
 *
 * Ganho e perda **não são etapas** do funil de vendas neste produto: o negócio
 * guarda a etapa em que estava (`closedStageId`) e muda de `status`. Um funil
 * de pós-venda montado sobre `etapa_do_negocio` nunca dispararia, porque o
 * cartão não se move ao ser fechado — e o sintoma seria o funil parecer certo e
 * não entrar ninguém.
 *
 * ## Dispara na transição, não no estado
 *
 * Quem chama compara com o status anterior. Sem isso, cada salvamento de um
 * negócio já fechado (corrigir o valor, trocar o motivo) reentraria o contato
 * no funil, e o cliente receberia a sequência de pós-venda de novo a cada
 * ajuste. Reabrir e fechar outra vez **é** um fechamento novo e dispara de
 * novo, o que é o comportamento certo: a venda aconteceu de novo.
 */
export async function negocioFoiFechado(
    workspaceId: string,
    contactId: string,
    desfecho: 'won' | 'lost'
): Promise<void> {
    await talvezEntrarNoFunil({
        tipo: desfecho === 'won' ? 'negocio_ganho' : 'negocio_perdido',
        workspaceId,
        contactId,
    })
}

/**
 * Alguém clicou num link de uma campanha de e-mail.
 *
 * Chamado do processador de recibos do SES, pelo evento `Click` — o dado já
 * chega, não há rastreio novo a construir.
 *
 * O clique é o único sinal de interesse que não depende de o contato responder,
 * e por isso vale como entrada de funil: separa quem reage de quem só recebe.
 * Abertura **não** entra: ela é inflada por pré-carregamento de imagem dos
 * clientes de e-mail (o Apple Mail Privacy Protection abre tudo), e um funil
 * montado sobre ela nutriria quem nunca olhou a mensagem.
 */
export async function clicouNaCampanha(workspaceId: string, contactId: string): Promise<void> {
    await talvezEntrarNoFunil({ tipo: 'clicou_na_campanha', workspaceId, contactId })
}

/**
 * Alguém pôs o contato no funil à mão.
 *
 * O gatilho genérico: nada dispara sozinho, e quem decide é uma pessoa olhando
 * a ficha. Existe porque todo critério que o produto não modela — "os que
 * conversei na feira", "os que o Dr. pediu para chamar" — caberia num campo
 * novo e numa regra nova, ou cabe neste botão.
 *
 * O funil ainda precisa estar **publicado** e com o gatilho `manual`: pôr à mão
 * não é furar o desenho, é ser a origem dele. E as três travas de entrada
 * continuam valendo (humano assumiu, opt-out, teto de ativos) — é a diferença
 * entre uma entrada manual e uma mensagem mandada na mão.
 */
export async function postoNoFunilAMao(
    workspaceId: string,
    contactId: string,
    funnelId: string
): Promise<void> {
    await talvezEntrarNoFunil({ tipo: 'manual', workspaceId, contactId, apenasFunil: funnelId })
}
