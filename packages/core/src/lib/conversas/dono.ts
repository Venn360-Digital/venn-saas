import prisma from '@venn/db/cliente'
import { readAutomations, MINUTOS_PARA_AUSENTE_PADRAO } from '../automations'
import {
    destinoDaEntrega,
    escolherDono,
    lerPoliticaDoCanal,
    type MembroElegivel,
    type PoliticaDeDistribuicao,
    type StatusDoMembro,
} from './distribuicao'
import { createLogger } from '../../trabalhos/registro'

const log = createLogger('DONO')

/**
 * A casca do dono da conversa: consulta, aplica a decisão, grava.
 *
 * **Casca fina de propósito.** Quem decide é `lib/conversas/distribuicao.ts`,
 * que é puro e provado em Node por `scripts/test-distribuicao.ts`. Aqui só mora
 * o que precisa de banco: quem são os elegíveis, quantas abertas cada um tem, e
 * a escrita. O workerd não roda nesta máquina — misturar as duas coisas tornaria
 * a parte que importa impossível de testar.
 *
 * Ver §11 de `docs/agente-ia/estudo-metodo-de-treinamento.md`.
 */

/**
 * A política em vigor para uma linha, mais o departamento dela.
 *
 * `departmentId` viaja junto porque sai da **mesma** consulta da política: a
 * linha é lida uma vez e responde às duas perguntas. Quando `elegiveisDaLinha`
 * buscava o departamento por conta própria, a entrada de toda conversa nova
 * fazia duas leituras da mesma linha — e o arquivo avisa que aqui o custo
 * importa.
 */
export type PoliticaEmVigor = PoliticaDeDistribuicao & {
    departmentId: string | null
    minutosParaAusente: number
}

/**
 * Os elegíveis, já com o que o rodízio e o balanceado precisam.
 *
 * **O departamento vem da linha, não da conversa** — é um fato do terreno, não
 * uma escolha: `AgentIntegration.departmentId` existe, `Conversation` não tem
 * departamento. Linha sem departamento (intake, widget, histórico antigo) abre
 * para todos os elegíveis do workspace, que é o que faz a fila geral existir.
 *
 * `recebeConversas` é marca por pessoa, e o papel só definiu o padrão na
 * migração. A regra "só ATENDENTE" quebraria a clínica de uma pessoa só.
 */
export async function elegiveisDaLinha(
    workspaceId: string,
    politica: Pick<PoliticaEmVigor, 'departmentId' | 'estrategia' | 'donoFixoUserId'>
): Promise<MembroElegivel[]> {
    const { departmentId } = politica

    /**
     * O atendente fixo entra na lista **mesmo fora do departamento da linha e
     * mesmo sem `recebeConversas`** — e sem isso o recurso não funcionaria.
     *
     * Nomear uma pessoa é mais específico que o departamento da linha: a clínica
     * que aponta a Fulana para o número da ortodontia não quer saber se ela está
     * naquele departamento, quer as conversas dele com ela. Com o filtro cego, a
     * linha ficaria configurada e nunca entregaria nada — configuração que não
     * faz efeito e não explica por quê.
     *
     * `isActive` **não** é relaxado, e é a única porta que fica fechada: quem
     * saiu da clínica não recebe paciente, qualquer que seja a configuração que
     * sobrou apontando para ela.
     */
    const fixo = politica.estrategia === 'fixo' ? politica.donoFixoUserId || null : null

    /**
     * Com `fixo`, a consulta traz **só ela** — e não a fila inteira mais ela.
     *
     * `escolherDono` em `fixo` procura um userId na lista e descarta o resto, e
     * `fixo` não tem desempate nem fallback para o rodízio (de propósito, ver
     * lá). Trazer o departamento todo seria buscar uma dúzia de membros e rodar
     * duas agregações sobre eles para jogar fora — na entrada de **toda**
     * mensagem daquela linha, que é o caso de uso do recurso.
     */
    const daFila = {
        recebeConversas: true,
        ...(departmentId ? { departments: { some: { departmentId } } } : {}),
    }

    const membros = await prisma.workspaceUser.findMany({
        where: {
            workspaceId,
            isActive: true,
            ...(fixo ? { userId: fixo } : daFila),
        },
        select: { userId: true, status: true, ultimaAtividadeEm: true, minutosParaAusente: true },
    })
    if (membros.length === 0) return []

    const ids = membros.map((m) => m.userId)

    /**
     * Duas agregações em vez de N consultas: a última atribuição e a contagem
     * de abertas saem cada uma num `groupBy`. Isto roda na entrada de **toda**
     * conversa nova, então o custo importa.
     */
    const [ultimas, abertas] = await Promise.all([
        prisma.conversation.groupBy({
            by: ['assignedTo'],
            where: { workspaceId, assignedTo: { in: ids } },
            _max: { ownerAssignedAt: true },
        }),
        prisma.conversation.groupBy({
            by: ['assignedTo'],
            where: { workspaceId, assignedTo: { in: ids }, status: 'active' },
            _count: { _all: true },
        }),
    ])

    const porUltima = new Map(ultimas.map((u) => [u.assignedTo, u._max.ownerAssignedAt]))
    const porAbertas = new Map(abertas.map((a) => [a.assignedTo, a._count._all]))

    return membros.map((m) => ({
        userId: m.userId,
        status: m.status as StatusDoMembro,
        ultimaAtribuicao: porUltima.get(m.userId) ?? null,
        abertas: porAbertas.get(m.userId) ?? 0,
        ultimaAtividadeEm: m.ultimaAtividadeEm,
        // A paciência da pessoa vinha no `select` e não chegava à decisão: a
        // ficha dizia 120 min e a distribuição usava 60. `estaDisponivel` lê
        // daqui com `??`, então nulo continua caindo no padrão do sistema.
        minutosParaAusente: m.minutosParaAusente,
    }))
}

/**
 * A política que vale aqui: **a estratégia do canal, se ele tiver uma; a da
 * conta, se não. O interruptor é sempre o da conta.**
 *
 * ## O que o canal decide, e o que não decide
 *
 * A estratégia era só da clínica, e isso não cobria o pedido do Andre
 * (26/11/2026): "um canal pode ter a atribuição para um atendente específico e
 * outro canal pode ter outro atendente ou mesmo o rodízio". Uma política por
 * conta não tem como dizer duas coisas.
 *
 * O canal decide **a estratégia e a pessoa**, que viajam juntas: canal em `fixo`
 * traz a pessoa dele, nunca a que sobrou na conta. O que ele **não** decide é o
 * `soDisponiveis` — esse é modificador da operação da clínica ("distribuo para
 * quem está fora?"), não do número por onde o paciente escreveu, e as três
 * opções que o Andre fixou para o canal não o incluem.
 *
 * Isto é a única mistura de campos que existe aqui, e é uma fronteira declarada,
 * não um merge: um campo é sempre da conta, os outros dois são sempre do canal
 * quando ele fala. Nenhuma combinação surpresa sai disso.
 *
 * `null` na coluna é "como na conta", e é o estado de toda linha que já existia:
 * por isso esta mudança não altera o comportamento de nenhuma clínica até alguém
 * configurar um canal. Mesma convenção de `departmentId` (nulo é fila geral) e
 * de `WorkspaceUser.minutosParaAusente` (nulo é o padrão do sistema).
 *
 * ## Duas leituras, em paralelo
 *
 * A da conta é sempre lida, mesmo quando o canal manda — é dela que sai o
 * interruptor, e é ela o piso quando a coluna está nula. As duas vão num
 * `Promise.all` para não somar latência na entrada da mensagem.
 */
async function politicaDo(workspaceId: string, integrationId: string | null): Promise<PoliticaEmVigor> {
    /**
     * **O escopo da linha passa pelo agente, e isto não é estilo.**
     * `AgentIntegration` não tem `workspaceId`: ela pertence a um `Agent`, que
     * pertence à clínica. Um `findFirst` só por `id` aceitaria a linha de outra
     * clínica se o id viesse errado — e aí a política de lá decidiria quem atende
     * aqui. Mesma regra de `lib/auth/workspace.ts` e de `resolverResponsavel`.
     */
    const [w, linha] = await Promise.all([
        prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { automations: true },
        }),
        integrationId
            ? prisma.agentIntegration.findFirst({
                  where: { id: integrationId, agent: { workspaceId } },
                  select: { departmentId: true, distribuicao: true },
              })
            : null,
    ])

    const daConta = readAutomations(w?.automations).distribuicao
    const doCanal = lerPoliticaDoCanal(linha?.distribuicao)

    return {
        // Estratégia e pessoa: do canal quando ele fala, da conta quando não.
        // O `doCanal ?` e não `doCanal.donoFixoUserId ??` é o que impede a
        // pessoa da conta de vazar para um canal que escolheu rodízio.
        estrategia: doCanal ? doCanal.estrategia : daConta.estrategia,
        donoFixoUserId: doCanal ? doCanal.donoFixoUserId : daConta.donoFixoUserId ?? null,
        // O interruptor é da conta, sempre. Ver o cabeçalho.
        soDisponiveis: daConta.soDisponiveis,
        departmentId: linha?.departmentId ?? null,
        // A queda para ausente não vem mais do JSON da conta: é constante do
        // sistema desde 2026-11-09, e quem quer outro número põe na ficha.
        minutosParaAusente: MINUTOS_PARA_AUSENTE_PADRAO,
    }
}

/**
 * Quem seria o próximo da fila — **a decisão, sem conversa nenhuma**.
 *
 * Mesma política e mesmos elegíveis de `darDono`: estratégia da conta
 * (rodízio ou balanceado), o interruptor "só disponíveis", `recebeConversas`
 * por pessoa e o departamento da linha. O que muda é não haver o que gravar.
 *
 * Existe porque o lead de um **formulário de captura** também é distribuído
 * (PRODUCT.md §17, decisão do Andre em 20/11/2026: "deve ser as mesmas regras
 * da atribuição de conversas que já existe, ao invés de ser apenas 1
 * responsável"), e ele produz um negócio mesmo quando não há conversa — a
 * pessoa que deixou só o e-mail, por exemplo. Reescrever a escolha no caminho
 * do formulário seria ter duas regras de rodízio que um dia discordam.
 *
 * `null` é resposta legítima: estratégia `nenhuma`, equipe toda indisponível
 * com o interruptor ligado, ou ninguém marcado como quem recebe. Nos três o
 * registro nasce **sem dono**, na fila — e é a varredura de
 * `varrerFilaSemDono` que lhe dá um quando alguém ficar disponível, pelo lado
 * da conversa.
 */
export async function proximoResponsavel(
    workspaceId: string,
    integrationId: string | null
): Promise<string | null> {
    try {
        const politica = await politicaDo(workspaceId, integrationId)
        if (politica.estrategia === 'nenhuma') return null

        const elegiveis = await elegiveisDaLinha(workspaceId, politica)
        return escolherDono(elegiveis, politica, politica.minutosParaAusente)
    } catch (erro) {
        // Distribuir é melhoria, não requisito — a mesma regra de `darDono`.
        log.warn(`não deu para escolher responsável em ${workspaceId}: ${String(erro)}`)
        return null
    }
}

/**
 * Dá dono a uma conversa que ainda não tem. Devolve o `userId`, ou `null`.
 *
 * **Idempotente por desenho:** o `updateMany` exige `assignedTo: null`, então
 * duas mensagens que cheguem no mesmo instante não trocam o responsável uma da
 * outra — a segunda não encontra linha para atualizar e sai sem fazer nada.
 *
 * Nunca lança. O chamador é o caminho de entrada da mensagem, e uma conversa
 * sem dono é um estado previsto — não um erro que justifique derrubar o
 * atendimento.
 */
export async function darDono(entrada: {
    workspaceId: string
    conversationId: string
    integrationId: string | null
    origem?: 'rodizio' | 'balanceado' | 'recepcao'
}): Promise<string | null> {
    // `ownerSource` grava a procedência, e `fixo` entra nela pela estratégia —
    // quem distribuiu continua auditável sem o chamador precisar saber disso.
    try {
        const politica = await politicaDo(entrada.workspaceId, entrada.integrationId)
        if (politica.estrategia === 'nenhuma') return null

        const elegiveis = await elegiveisDaLinha(entrada.workspaceId, politica)
        const escolhido = escolherDono(elegiveis, politica, politica.minutosParaAusente)
        if (!escolhido) return null

        /**
         * Grava `assignedTo` — onde a tela procura o responsável.
         *
         * **Era `ownerId`, e tinha de ser**, porque `assignedTo` era o mutex do
         * agente: distribuir por ele calaria o bot no ato de distribuir. Com o
         * mutex movido para `atendidaPor` (ver `isHumanHandled`), a razão caiu.
         *
         * O defeito que isto conserta foi medido no primeiro lead que chegou
         * depois do deploy do portão: `ownerId` = Rachel, `assignedTo` nulo, e a
         * conversa invisível nas "Minhas" dela. É o que o Andre relatou como
         * "o lead entra, ganha um responsável e não aparece no filtro minhas".
         *
         * **`atendidaPor` não é tocado aqui, de propósito.** Distribuir diz de
         * quem a conversa é; não diz que alguém já a está atendendo. O lead
         * recém-chegado nasce `bot` e continua `bot` depois do rodízio — é
         * exatamente a combinação "Com a IA + com responsável" que a coluna
         * passou a saber mostrar.
         *
         */
        const r = await prisma.conversation.updateMany({
            /**
             * A guarda é `assignedTo: null` — a coluna que a distribuição
             * agora preenche, e portanto a que diz se ela já rodou aqui.
             *
             * Era `ownerId: null`, e tinha de ser enquanto `ownerId` era onde o
             * responsável morava. Trocar as duas coisas em deploys separados
             * seria pedir para uma conversa ser distribuída duas vezes na
             * janela entre eles.
             */
            where: {
                id: entrada.conversationId,
                workspaceId: entrada.workspaceId,
                assignedTo: null,
            },
            data: {
                assignedTo: escolhido,
                /**
                 * `ownerAssignedAt` e `ownerSource` **ficam, com estes nomes.**
                 *
                 * O primeiro é a única coluna que responde "quando esta pessoa
                 * recebeu a última conversa", e é dela que sai a ordem do
                 * rodízio — sem ela não há como saber quem esperou mais.
                 * O segundo é a procedência (`rodizio` | `ia` | `assumiu`), que
                 * é como se audita quem distribuiu.
                 *
                 * Os nomes são históricos e ficam: renomear coluna exige três
                 * deploys (adicionar, copiar, derrubar) porque a migração roda
                 * antes do publish, e o ganho seria estético.
                 */
                ownerAssignedAt: new Date(),
                ownerSource: entrada.origem ?? politica.estrategia,
            },
        })
        if (r.count === 0) return null

        log.info(`conversa ${entrada.conversationId} → ${escolhido} (${politica.estrategia})`)
        await herdarNoNegocio(entrada.workspaceId, entrada.conversationId, escolhido)
        return escolhido
    } catch (erro) {
        // Distribuir é melhoria, não requisito: falhar aqui não pode impedir a
        // mensagem de ser atendida.
        log.warn(`não deu para distribuir ${entrada.conversationId}: ${String(erro)}`)
        return null
    }
}

/**
 * O negócio aberto desta pessoa herda o dono que a conversa acabou de ganhar.
 *
 * ## Por que isto não é enfeite
 *
 * O produto promete que "no negócio que nasce da primeira mensagem o dono é
 * quem assume a conversa" (PRODUCT.md §11). A promessa valia no instante da
 * criação e só ali: com o interruptor "só disponíveis" ligado e a equipe toda
 * fora, a conversa **e** o negócio nasciam órfãos, e a varredura de
 * `varrerFilaSemDono` dava dono à conversa de manhã e deixava o negócio sem
 * ninguém — para sempre, porque nada mais olha para ele. O lead de formulário
 * tornou o caso comum (ele cria negócio em toda chegada), e é parte do que o
 * Andre pediu em 20/11/2026: se todo mundo estiver indisponível, o registro
 * entra na fila do rodízio — e entrar na fila só vale se a fila entregar.
 *
 * ## Só preenche o vazio
 *
 * `userId: null` na condição, nunca sobrescrita: negócio que já tem
 * responsável é decisão de alguém — do rodízio anterior ou de quem o puxou na
 * mão — e trocar isso por causa de uma conversa seria tirar da carteira de uma
 * pessoa o que ela já tinha.
 *
 * Nunca lança: é o fim do caminho da distribuição, e a conversa já tem dono.
 */
async function herdarNoNegocio(workspaceId: string, conversationId: string, dono: string): Promise<void> {
    try {
        const conversa = await prisma.conversation.findFirst({
            where: { id: conversationId, workspaceId },
            select: { contactId: true },
        })
        if (!conversa?.contactId) return

        const r = await prisma.deal.updateMany({
            where: { workspaceId, contactId: conversa.contactId, status: 'open', userId: null },
            data: { userId: dono },
        })
        if (r.count > 0) log.info(`${r.count} negócio(s) de ${conversa.contactId} → ${dono}`)
    } catch (erro) {
        log.warn(`não deu para herdar o dono no negócio de ${conversationId}: ${String(erro)}`)
    }
}

/**
 * Para quem vai a entrega — e aqui o status vale **sempre**.
 *
 * O responsável serve a duas coisas: a carteira e saber quem entra quando a IA
 * não dá conta. A primeira tolera erro; a segunda não. Se ele não está
 * disponível, a entrega vai para a fila geral, visível a todos.
 *
 * O caso concreto: paciente com dor às 19h, responsável designado às 14h já em
 * casa.
 *
 * O parâmetro é o `assignedTo` da conversa. Era o `ownerId`, e a troca é a
 * mesma de `darDono`: o responsável deixou de morar numa coluna que a tela não
 * lê.
 */
export async function donoDisponivel(
    workspaceId: string,
    responsavel: string | null
): Promise<string | null> {
    if (!responsavel) return null

    /**
     * Uma consulta só, e não duas.
     *
     * Havia um `politicaDo` aqui em paralelo, e dele se usava **um** campo:
     * `minutosParaAusente`. Esse campo deixou de sair do JSON da conta em
     * 2026-11-09 e passou a ser constante do sistema, então a leitura do
     * workspace virava uma ida ao banco cujo resultado era descartado. Nenhuma
     * outra parte da política pesa aqui: a entrega lê status, não estratégia.
     */
    const m = await prisma.workspaceUser.findFirst({
        where: { workspaceId, userId: responsavel, isActive: true },
        select: { userId: true, status: true, ultimaAtividadeEm: true, minutosParaAusente: true },
    })
    if (!m) return null

    return destinoDaEntrega(
        {
            userId: m.userId,
            status: m.status as StatusDoMembro,
            ultimaAtribuicao: null,
            abertas: 0,
            ultimaAtividadeEm: m.ultimaAtividadeEm,
            minutosParaAusente: m.minutosParaAusente,
        },
        MINUTOS_PARA_AUSENTE_PADRAO
    )
}

/**
 * Quando alguém fica disponível, a fila sem dono encontra responsável.
 *
 * **Este é o momento em que a madrugada vira carteira.** Com o interruptor
 * ligado e ninguém disponível, as conversas da noite nascem órfãs; sem esta
 * varredura ficariam assim até a mensagem seguinte do paciente — que pode não
 * vir. Quem abre o sistema às 8h encontra o que fazer, que era o pedido.
 *
 * **Uma de cada vez, com teto.** Distribuir o lote inteiro faria a primeira
 * pessoa a chegar levar a noite toda, e a segunda chegar meia hora depois para
 * uma fila vazia. Com o teto, o resto espera mais gente ficar disponível — ou a
 * própria pessoa esvaziar o que pegou e voltar a puxar.
 *
 * Reusa `escolherDono` a cada volta em vez de atribuir tudo a quem acabou de
 * chegar: se outra pessoa ficar disponível no meio, ela entra no rodízio.
 *
 * Nunca lança: é chamada sem `await` de uma rota que já respondeu.
 */
export async function varrerFilaSemDono(workspaceId: string, gatilho: string): Promise<number> {
    /**
     * O teto não é configurável de propósito. É proteção contra o caso
     * patológico (uma noite de 40 conversas), não um ajuste de operação — e
     * cada número que o cliente pode mexer é um número que ele precisa
     * entender.
     */
    const TETO = 5

    try {
        /**
         * **Sem guarda de política aqui, e isto é um conserto.**
         *
         * Havia um `politicaDo(workspaceId)` com `if (estrategia === 'nenhuma')
         * return 0` antes de olhar conversa nenhuma. Com a política podendo vir
         * da linha, essa saída passou a estar errada: a clínica que deixa a conta
         * em "sem distribuição" e configura **uma** linha com atendente fixo
         * nunca teria a fila varrida, e as conversas daquela linha ficariam
         * órfãs para sempre — exatamente o caso que a varredura existe para
         * resolver.
         *
         * Quem decide agora é `darDono`, uma vez por conversa, com a política da
         * linha daquela conversa. A consulta abaixo continua sendo a saída
         * barata do caso comum: fila vazia encerra a varredura numa leitura.
         */
        const semDono = await prisma.conversation.findMany({
            where: { workspaceId, assignedTo: null, status: 'active' },
            select: { id: true, integrationId: true },
            orderBy: { createdAt: 'asc' },
            take: TETO,
        })
        if (semDono.length === 0) return 0

        let deu = 0
        for (const c of semDono) {
            const quem = await darDono({
                workspaceId,
                conversationId: c.id,
                integrationId: c.integrationId,
            })
            if (quem) deu++
        }

        if (deu > 0) log.info(`${deu} conversa(s) sem dono distribuída(s) após ${gatilho} ficar disponível`)
        return deu
    } catch (erro) {
        log.warn(`varredura da fila falhou em ${workspaceId}: ${String(erro)}`)
        return 0
    }
}
