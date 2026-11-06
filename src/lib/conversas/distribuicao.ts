/**
 * Quem recebe a próxima conversa — a decisão, sem banco.
 *
 * Função pura sobre a lista de elegíveis, no padrão da casa: quem consulta é a
 * casca, quem decide é isto. O workerd não roda nesta máquina, então toda
 * escolha que precisa de prova vive aqui e é exercitada em Node por
 * `scripts/test-distribuicao.ts`.
 *
 * ## O que este módulo NÃO decide
 *
 * Não decide **quem está na lista**. Quem monta a lista é a consulta, que já
 * aplica o workspace, o departamento da linha, `isActive` e `recebeConversas`.
 * Misturar as duas coisas faria a parte testável depender do banco.
 *
 * Ver §11 de `docs/agente-ia/estudo-metodo-de-treinamento.md`.
 */

/**
 * Os quatro estados, no modelo do Teams. Só `disponivel` recebe conversa.
 *
 * | cor | estado | como se chega |
 * |---|---|---|
 * | verde | `disponivel` | login, escolha, ou voltar a mexer |
 * | vermelho | `ocupado` | **só manual** — a escada nunca produz |
 * | amarelo | `ausente` | escolha, ou 1h parado |
 * | cinza | `desconectado` | 8h parado, ou logout |
 *
 * A coluna guarda o que a pessoa **escolheu**; o que a tela mostra e o que o
 * sistema usa saem de `estadoVisivel`, que aplica a escada. São a mesma conta
 * nos dois lados de propósito: tela dizendo uma coisa e sistema fazendo outra
 * foi o defeito da primeira versão.
 */
export type StatusDoMembro = 'disponivel' | 'ocupado' | 'ausente' | 'desconectado'

/** `nenhuma` desliga a distribuição: a conversa nasce sem dono, como antes. */
export type EstrategiaDeDistribuicao = 'nenhuma' | 'rodizio' | 'balanceado'

export interface MembroElegivel {
    userId: string
    status: StatusDoMembro
    /**
     * Quando esta pessoa recebeu a última conversa. **Nulo é "nunca recebeu"**,
     * e nunca recebeu vem primeiro — senão quem entra na equipe hoje só
     * receberia depois de todo mundo dar uma volta inteira.
     */
    ultimaAtribuicao: Date | null
    /** Conversas abertas em que é dona. Só o balanceado lê. */
    abertas: number
    /**
     * Última ação na aplicação. **Nulo é "nunca agiu"**, e nunca agiu não está
     * disponível — é o estado de quem foi cadastrado e ainda não entrou.
     */
    ultimaAtividadeEm?: Date | null
    /**
     * A paciência desta pessoa, em minutos. **Nulo = o padrão da conta.**
     *
     * Opcional no tipo porque a maioria dos chamadores não tem motivo para
     * trazê-la — e quem não a trouxer continua caindo no padrão, que é o
     * comportamento de antes. Ver `WorkspaceUser.minutosParaAusente`.
     */
    minutosParaAusente?: number | null
}

export interface PoliticaDeDistribuicao {
    estrategia: EstrategiaDeDistribuicao
    /**
     * O interruptor. **Desligado por padrão**, e a razão são dois formatos de
     * empresa que não cabem na mesma regra:
     *
     *   - empresa que atende 8h–18h: à noite estão todos ausentes. Com o filtro
     *     ligado, o lead da madrugada ficaria sem dono e ninguém teria carteira
     *     de manhã. Desligado, ele ganha dono e quem chega já tem o que fazer;
     *   - empresa com turnos: ligado, para o lead das 2h não cair em quem
     *     trabalha de manhã e nunca vai olhar.
     *
     * É o mesmo recorte do respond.io, onde "Rodada Robin" e "Robin redondo +
     * Apenas Online" são coisas separadas: online é **modificador** da
     * estratégia, não estratégia.
     */
    soDisponiveis: boolean
}

export const POLITICA_PADRAO: PoliticaDeDistribuicao = {
    estrategia: 'nenhuma',
    soDisponiveis: false,
}

/**
 * Depois de quanto tempo parado o verde vira cinza.
 *
 * **Fixo, ao contrário do primeiro degrau.** Oito horas não é ajuste de
 * operação: é "não voltou hoje". Expor o número daria ao cliente mais uma
 * decisão que ele não tem como tomar bem, e o primeiro degrau — o que importa
 * — já é configurável.
 */
export const MINUTOS_PARA_DESCONECTADO = 8 * 60

/**
 * O que a tela mostra e o que o sistema usa. **A mesma conta nos dois.**
 *
 * A escada só mexe em quem está **verde**: escolha manual é pegajosa. Sem isso,
 * quem se marca "ocupado" para uma reunião e abre o sistema para conferir um
 * horário voltaria a verde no clique — e receberia lead no meio da reunião.
 *
 * Quem escolheu ocupado ou ausente fica onde se pôs, até mudar ou até o próximo
 * login, que devolve ao verde. É o que evita alguém ficar preso em vermelho.
 *
 * Derivado e não gravado, como no Teams: nenhum cron vira status de madrugada, e
 * a conta é pura — provável sem banco. O que a primeira versão errou não foi
 * derivar; foi derivar **escondido**, com o badge dizendo "Disponível" enquanto
 * o sistema já não entregava nada.
 */
export function estadoVisivel(
    status: StatusDoMembro,
    ultimaAtividadeEm: Date | null | undefined,
    minutosParaAusente: number,
    agora: Date = new Date()
): StatusDoMembro {
    if (status !== 'disponivel') return status
    if (minutosParaAusente <= 0) return 'disponivel'

    // Verde sem atividade nenhuma é quem foi cadastrado e nunca entrou.
    if (!ultimaAtividadeEm) return 'desconectado'

    const paradoMin = (agora.getTime() - ultimaAtividadeEm.getTime()) / 60_000
    if (paradoMin > MINUTOS_PARA_DESCONECTADO) return 'desconectado'
    if (paradoMin > minutosParaAusente) return 'ausente'
    return 'disponivel'
}

/**
 * Está mesmo disponível? **O status sozinho não basta.**
 *
 * Quem sai às 18h esquecendo de mudar continua marcado como disponível, e a
 * distribuição da madrugada cairia em quem não está — exatamente o que o
 * interruptor existe para evitar. Por isso a disponibilidade é a conjunção de
 * duas coisas: o que a pessoa marcou **e** ter agido no sistema há pouco.
 *
 * **Derivado, não gravado.** Um job que virasse o status de madrugada daria o
 * mesmo resultado e custaria um cron, uma escrita e um estado a mais para
 * divergir. Aqui a conta é feita na hora, com a data na mão, e por isso é
 * testável sem banco.
 *
 * `minutos = 0` desliga a queda: a conta que prefere confiar no que foi marcado
 * à mão pode, e aí só o status vale.
 */
export function estaDisponivel(m: MembroElegivel, minutosParaAusente: number, agora: Date): boolean {
    /**
     * O da pessoa ganha do da conta, e o `??` é o que faz isso.
     *
     * `minutosParaAusente` do argumento é o padrão da conta; o do membro é a
     * exceção. Com `??` e não `||`, **zero continua valendo** — e zero tem
     * significado: desliga a queda automática para aquela pessoa, que é o caso
     * de quem trabalha fora da tela e não pode ser tirado da fila por isso.
     * Com `||`, zero cairia no padrão e a exceção seria impossível de expressar.
     */
    const minutos = m.minutosParaAusente ?? minutosParaAusente
    return estadoVisivel(m.status, m.ultimaAtividadeEm, minutos, agora) === 'disponivel'
}

/** `disponivel` recebe; `ocupado` e `ausente` não. Os dois últimos são iguais aqui. */
export function podeReceber(
    m: MembroElegivel,
    politica: PoliticaDeDistribuicao,
    minutosParaAusente = 0,
    agora: Date = new Date()
): boolean {
    return politica.soDisponiveis ? estaDisponivel(m, minutosParaAusente, agora) : true
}

/**
 * Ordena pelo critério do rodízio: quem recebeu **há mais tempo** primeiro.
 *
 * Round robin **sem ponteiro**, de propósito. Um cursor guardado teria de ser
 * atualizado em transação, se corromperia na concorrência, e ficaria errado
 * toda vez que alguém entrasse ou saísse da equipe. Derivar a ordem de
 * `ultimaAtribuicao` não tem estado para corromper: a resposta é sempre
 * recalculada do fato.
 *
 * O desempate é o `userId`, e existe para a função ser **determinística** —
 * duas pessoas que nunca receberam têm de produzir sempre a mesma escolha, ou
 * o teste não prova nada.
 */
function porRodizio(a: MembroElegivel, b: MembroElegivel): number {
    const ta = a.ultimaAtribuicao?.getTime() ?? -Infinity
    const tb = b.ultimaAtribuicao?.getTime() ?? -Infinity
    if (ta !== tb) return ta - tb
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
}

/**
 * Quem fica com a próxima conversa. `null` quando não há ninguém.
 *
 * **`null` é resposta legítima, não erro.** Acontece com a estratégia
 * `nenhuma`, com a equipe toda ausente e o interruptor ligado, e na conta que
 * ainda não marcou ninguém como `recebeConversas`. Nos três casos a conversa
 * nasce sem dono e fica na fila geral — visível a todos —, e ganha dono quando
 * alguém ficar disponível ou no handoff.
 */
export function escolherDono(
    elegiveis: readonly MembroElegivel[],
    politica: PoliticaDeDistribuicao,
    minutosParaAusente = 0,
    agora: Date = new Date()
): string | null {
    if (politica.estrategia === 'nenhuma') return null

    const candidatos = elegiveis.filter((m) => podeReceber(m, politica, minutosParaAusente, agora))
    if (candidatos.length === 0) return null

    if (politica.estrategia === 'balanceado') {
        /**
         * Menos conversas abertas, **com o rodízio como desempate**.
         *
         * Sem o desempate, uma equipe parada (todo mundo com zero aberta) daria
         * sempre a mesma pessoa — a primeira da lista —, e o "balanceado"
         * entregaria tudo a ela até ela passar à frente. O desempate por rodízio
         * é o que mantém a justiça quando a carga está igual.
         */
        return [...candidatos].sort((a, b) =>
            a.abertas !== b.abertas ? a.abertas - b.abertas : porRodizio(a, b)
        )[0].userId
    }

    return [...candidatos].sort(porRodizio)[0].userId
}

/**
 * Para onde vai a entrega quando o humano precisa entrar.
 *
 * **Esta é a parte que mais importa, e vale com o interruptor ligado ou
 * desligado.** O dono serve a duas coisas: a carteira ("minhas conversas") e
 * saber quem entra quando a IA não dá conta. A primeira tolera erro; a segunda
 * não.
 *
 * Se o dono não está disponível — foi embora, está em reunião, é de outro turno
 * —, a entrega **não fica parada com ele**: vai para a fila geral, que todo
 * mundo vê. O caso que isto evita é concreto: paciente com dor às 19h, dono
 * designado às 14h já em casa.
 *
 * Repare que aqui o status é lido **sempre**, e não só quando `soDisponiveis`
 * está ligado. O interruptor decide quem *recebe carteira*; isto decide quem
 * *atende agora*, e são perguntas diferentes.
 */
export function destinoDaEntrega(
    dono: MembroElegivel | null,
    minutosParaAusente = 0,
    agora: Date = new Date()
): string | null {
    if (!dono) return null
    return estaDisponivel(dono, minutosParaAusente, agora) ? dono.userId : null
}
