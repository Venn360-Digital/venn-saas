import type { Prisma } from '@venn/db'

/**
 * Os recortes da coluna de Conversas — as abas e o seletor `Ver`.
 *
 * ## Duas perguntas, dois controles
 *
 * O nó que isto desfaz: `assignedTo` respondia **duas** perguntas de uma vez, e
 * por isso a aba "Em espera" era `assignedTo IS NULL` — "sem responsável" com
 * nome de "aguardando". Medido em produção: das 45 conversas abertas, 44 tinham
 * `assignedTo`, então a aba mostrava 1. Não era contagem errada; era nome
 * errado, porque não havia como perguntar uma coisa sem perguntar a outra.
 *
 * Agora há:
 *
 * | controle | pergunta | campo |
 * | --- | --- | --- |
 * | aba | em que **estado** está | `status` + `atendidaPor` |
 * | `Ver` | qual a **minha relação** com ela | `assignedTo` + `collaborators` |
 *
 * As duas se combinam livres (3 × 4), e a combinação que não existia é a que
 * resolve o caso do lead que acabou de chegar: **Com a IA + Sem responsável**.
 *
 * ## Por que é módulo puro
 *
 * Porque a lista e a contagem das abas são duas consultas diferentes que têm de
 * concordar. Quando cada uma monta o seu `where`, elas divergem — e divergência
 * aqui aparece como contador dizendo 12 e a lista mostrando 9, que é o tipo de
 * defeito que ninguém reporta e todo mundo deixa de confiar na tela.
 */

/** A aba: o estado da conversa. */
export type Aba = 'ia' | 'equipe' | 'finalizadas'

/**
 * O seletor `Ver`: a relação de quem pergunta com a conversa.
 *
 * `nao-lidas` é o intruso desta lista, e é de propósito: não é uma relação com
 * quem pergunta, é um estado da conversa — o lugar "certo" seria uma aba. Mas as
 * abas respondem "em que estado está o atendimento" (com a IA, com a equipe,
 * finalizada), e não lida atravessa as três: a clínica quer ver o que não leu
 * **dentro** da aba em que está trabalhando. Como quarta aba, obrigaria a
 * escolher entre "não lidas" e "com a equipe"; aqui, combina com qualquer uma.
 *
 * Foi pedido assim: "tem como acrescentar no filtro a opção para ver as
 * mensagens não lidas".
 */
export type Ver = 'todas' | 'minhas' | 'colaboro' | 'sem-responsavel' | 'nao-lidas'

/**
 * Os nomes antigos de aba, que a rota continua aceitando.
 *
 * `waiting`/`active`/`closed` estão em query string de aba aberta, em link
 * colado no WhatsApp da equipe e em qualquer script que alguém tenha feito. Um
 * deploy que os recusasse mandaria essa gente para uma lista vazia sem dizer
 * por quê — então eles traduzem, e a tela nova escreve os novos.
 *
 * `waiting` → `ia` e `active` → `equipe` é a tradução **de intenção**, não de
 * campo: quem pedia "em espera" queria o que ainda não tem gente, e com o
 * portão isso é o que está com a IA.
 */
const ABA_ANTIGA: Record<string, Aba> = {
    waiting: 'ia',
    active: 'equipe',
    closed: 'finalizadas',
}

export function lerAba(valor: string | null | undefined): Aba {
    if (valor === 'ia' || valor === 'equipe' || valor === 'finalizadas') return valor
    return ABA_ANTIGA[valor ?? ''] ?? 'ia'
}

export function lerVer(valor: string | null | undefined, onlyMineAntigo: boolean): Ver {
    if (
        valor === 'todas' ||
        valor === 'minhas' ||
        valor === 'colaboro' ||
        valor === 'sem-responsavel' ||
        valor === 'nao-lidas'
    ) {
        return valor
    }
    // `onlyMine=true` era o segmento de dois estados. Vira `minhas`.
    return onlyMineAntigo ? 'minhas' : 'todas'
}

/**
 * O recorte da aba.
 *
 * `atendidaPor` e não `assignedTo`: é a mudança inteira. "Com a IA" é a conversa
 * que a equipe ainda não assumiu, **tenha ou não** responsável — e é por isso
 * que a conversa atribuída a quem já foi para casa continua aparecendo para
 * todo mundo em vez de ficar presa na carteira dele.
 */
export function recorteDaAba(aba: Aba): Prisma.ConversationWhereInput {
    switch (aba) {
        case 'ia':
            return { status: 'active', atendidaPor: 'bot' }
        case 'equipe':
            return { status: 'active', atendidaPor: 'humano' }
        case 'finalizadas':
            return { status: 'closed' }
    }
}

/**
 * O recorte do `Ver`. `null` para "todas", que é ausência de recorte.
 *
 * `null` e não `{}`: um objeto vazio dentro de um `AND` é ruído que aparece em
 * todo log de consulta e em toda prova, e esconde se o filtro foi aplicado ou
 * não. Quem chama decide se põe.
 */
export function recorteDoVer(ver: Ver, userId: string): Prisma.ConversationWhereInput | null {
    switch (ver) {
        case 'todas':
            return null
        case 'minhas':
            return { assignedTo: userId }
        case 'colaboro':
            return { collaborators: { some: { userId } } }
        case 'sem-responsavel':
            return { assignedTo: null }
        /**
         * Não lida **não se escreve em Prisma**, e por isso sai daqui nula.
         *
         * O corte é "mensagem recebida mais nova que o `lastReadAt` **daquela**
         * conversa", e comparar o campo de uma relação com a coluna da linha-mãe
         * não é expressável no `where`: `messages: { some: { createdAt: { gt: ??? } } }`
         * não tem como apontar para `conversation.lastReadAt`. Contar tudo e
         * filtrar em memória traria as mensagens inteiras do banco.
         *
         * Então quem a aplica é a rota, com a mesma consulta crua que ela já faz
         * para o medidor de não-lidas — ver `lib/conversas/nao-lidas.ts`. Este
         * módulo continua puro, que é a razão de ele existir.
         *
         * Nulo e não um objeto vazio, pela mesma regra dos outros: `{}` dentro de
         * um `AND` esconde se o filtro foi aplicado.
         */
        case 'nao-lidas':
            return null
    }
}

/**
 * O teto do atendente, que o `Ver` **não** levanta.
 *
 * Decisão antiga do produto e preservada aqui de propósito: o atendente vê o
 * que é dele e o que não é de ninguém — a fila de onde se puxa trabalho — e não
 * vê a conversa que outra pessoa está atendendo. Isto já existia; o que mudou é
 * que antes estava escrito dentro do `switch` das abas (`assignedTo = user.id`
 * em "Ativas" e "Finalizadas", e nada em "Em espera"), e agora é uma cláusula
 * só, independente de aba.
 *
 * **Por que tem de ser separado do `Ver`:** sem isto, o atendente que escolhesse
 * "Todas" passaria a ver a carteira dos colegas — um seletor novo abrindo
 * visibilidade que ninguém pediu. Com isto, "Todas" significa "tudo o que eu
 * posso ver", que é o que a palavra quer dizer para ele.
 *
 * A terceira cláusula é nova e é o item 6: a conversa em que ele colabora entra
 * mesmo sendo de outra pessoa — foi para isso que alguém o marcou.
 */
export function limiteDoAtendente(userId: string): Prisma.ConversationWhereInput {
    return {
        OR: [
            { assignedTo: userId },
            { assignedTo: null },
            { collaborators: { some: { userId } } },
        ],
    }
}

/**
 * As opções que a tela oferece, por papel.
 *
 * O atendente não recebe "Sem responsável" porque, para ele, ela é quase igual
 * a "Todas" — o teto acima já lhe mostra a fila sem responsável inteira, e a
 * diferença entre as duas seria só esconder as dele. Opção que não distingue
 * nada é opção que ensina a desconfiar do seletor.
 */
export function opcoesDeVer(role: string): Ver[] {
    const todas: Ver[] = ['todas', 'nao-lidas', 'minhas', 'colaboro', 'sem-responsavel']
    return role === 'ATENDENTE' ? todas.filter((v) => v !== 'sem-responsavel') : todas
}

/** O rótulo de cada opção. Vive junto do tipo para não divergir dele. */
export const ROTULO_DO_VER: Record<Ver, string> = {
    todas: 'Todas',
    'nao-lidas': 'Não lidas',
    minhas: 'Minhas',
    colaboro: 'Que eu colaboro',
    'sem-responsavel': 'Sem responsável',
}

/** O rótulo de cada aba. Mesma razão. */
export const ROTULO_DA_ABA: Record<Aba, string> = {
    ia: 'Com a IA',
    equipe: 'Com a equipe',
    finalizadas: 'Finalizadas',
}
