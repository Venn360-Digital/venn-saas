/**
 * O que a conta recebe **pronto** ao terminar o cadastro.
 *
 * ## Por que existe
 *
 * O cadastro terminava criando workspace, assinatura e um agente, e entregava
 * tudo o mais vazio: funil sem etapa, fechamento sem motivo, agente com
 * `preferences` nula — e `preferences` nula significa, por desenho,
 * `UNCONFIGURED_AGENT_PREFERENCES`, que é tudo **desligado**. Então o primeiro
 * agente de toda clínica nascia sem "digitando…", sem emoji, sem recorte de
 * assunto e sem limite de interação, e a clínica tinha de descobrir cada
 * interruptor para chegar ao comportamento que o produto considera o certo.
 *
 * Esta é a lista que o Andre ditou em 2026-11-04. Mora aqui, num lugar só, e
 * não espalhada pela transação do cadastro: é configuração de produto, e a
 * próxima mudança dela tem de ser uma linha, não uma caça.
 *
 * ## O que NÃO entra aqui
 *
 * Nada que já tenha padrão declarado em outro módulo. O conjunto de preferências
 * do agente é `DEFAULT_AGENT_PREFERENCES`, as etapas são
 * `DEFAULT_PIPELINE_STAGES`, a política de ausência é `DEFAULT_AUTOMATIONS` —
 * duplicar qualquer um deles aqui criaria a segunda fonte que os comentários
 * daqueles arquivos existem para evitar.
 */

/**
 * Por que a clínica ganha e por que ela perde, na lista com que a conta começa.
 *
 * **Em ordem alfabética**, a pedido dele — e a ordem importa porque é a ordem
 * em que a lista aparece no fechamento do negócio: `order` é gravado a partir
 * do índice, então reordenar aqui reordena a tela.
 *
 * A lista de perda também foi alfabetada. Ele pediu a ordem para a de ganho;
 * aplicar só num lado deixaria duas listas irmãs com critérios diferentes no
 * mesmo diálogo.
 *
 * Isto é a lista **inicial**, não a definitiva: a tela de motivos é dela, e a
 * clínica que fecha por parcelamento acrescenta o dela no primeiro dia. Era
 * justamente por não haver lista inicial que a tela de fechamento abria vazia.
 */
export const MOTIVOS_PADRAO = {
    won: [
        'Atendimento',
        'Autoridade',
        'Indicação',
        'Melhor solução',
        'Preço competitivo',
        'Urgência',
    ],
    lost: [
        'Concorrência',
        'Momento inadequado',
        'Não qualificado',
        'Preço alto',
        'Sumiu / sem contato',
    ],
} as const

/**
 * A estratégia de distribuição com que a conta nasce: rodízio.
 *
 * `POLITICA_PADRAO` continua `nenhuma`, e isso **não** é contradição — ela é o
 * que vale para conta que já existe e nunca escolheu, onde ligar distribuição
 * sozinho mudaria a operação de alguém sem pedir. Para conta que nasce agora não
 * há operação para mudar, e o Andre escolheu rodízio.
 *
 * `soDisponiveis` fica desligado e `minutosParaAusente` em 60 — que são os
 * valores de `DEFAULT_AUTOMATIONS`, pedidos de novo por ele. Não são repetidos
 * aqui: o cadastro grava a política em cima do default, só trocando a
 * estratégia.
 */
export const ESTRATEGIA_INICIAL = 'rodizio' as const

/**
 * O fuso com que toda conta nasce: São Paulo.
 *
 * Pedido do Andre em 2026-11-04, para os três apps — inclusive o que vende fora
 * do Brasil. O cadastro não pergunta o fuso, e perguntar seria um campo a mais
 * num passo que acabou de perder o de endereço; quem opera em outro fuso troca
 * em Conta → Conta da empresa, e é uma vez na vida da conta.
 *
 * **Gravado, não herdado** — mesmo motivo de `ESTRATEGIA_INICIAL`.
 * `FUSO_DO_NEGOCIO` é o fallback de quem nunca escolheu, e são coisas
 * diferentes: se o cadastro deixasse a coluna em branco, trocar o fallback
 * amanhã trocaria o relógio de todas as contas antigas de uma vez. Aqui a
 * escolha fica escrita na conta, com o valor que valia no dia em que ela nasceu.
 */
export const FUSO_INICIAL = 'America/Sao_Paulo' as const
