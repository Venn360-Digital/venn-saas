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
 * Não decide **quem está na lista** — mas decide o **recorte** dela, desde que
 * `fixo` existe (26/11/2026). Quem executa a consulta segue sendo a casca, que
 * aplica o workspace e o `isActive`; o que passou para cá é a parte que depende
 * da estratégia, e portanto é decisão: `fixo` ignora o departamento da linha e
 * obedece ao `recebeConversas` da pessoa, e as outras estratégias fazem o
 * contrário. Ver `recorteDeElegiveis`.
 *
 * Mudou de lado porque virou regra de negócio com caso de uso contado, e regra
 * assim não pode morar só numa cláusula `where` que nenhum teste lê.
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

/**
 * `nenhuma` desliga a distribuição: a conversa nasce sem dono, como antes.
 *
 * `fixo` é a exceção que não é fila: a linha tem **um** atendente, e toda
 * conversa dela vai para ele. Existe porque o pedido do Andre (26/11/2026) é
 * concreto: um número de WhatsApp sem rodízio, entregue direto a uma pessoa, ao
 * lado de outro número que roda a fila normalmente. Antes dela a única forma de
 * expressar isso era um departamento de um membro só — que dá o mesmo resultado
 * por acidente e some no dia em que alguém entra no departamento.
 */
export type EstrategiaDeDistribuicao = 'nenhuma' | 'rodizio' | 'balanceado' | 'fixo'

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
     * A paciência desta pessoa, em minutos. **Nulo = o padrão do sistema** (`MINUTOS_PARA_AUSENTE_PADRAO`).
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
    /**
     * A pessoa, quando a estratégia é `fixo`. Ignorado nas outras.
     *
     * **Nulo com `fixo` não escolhe ninguém**, e isso é de propósito: política
     * pela metade não pode virar rodízio por conta própria. A conversa nasce sem
     * dono e aparece na fila geral, que é onde alguém a vê e a assume — o mesmo
     * destino de toda política que não resolve.
     *
     * Mora no JSON e não em coluna com chave estrangeira, e o custo é conhecido:
     * ninguém apaga este id quando a pessoa sai da clínica. Quem fecha essa porta
     * é a consulta dos elegíveis, que só traz membro ativo — id órfão não entra na
     * lista, `escolherDono` devolve nulo e a tela da linha acusa. A alternativa
     * seria uma coluna com `onDelete: SetNull`, ao custo de dois mecanismos
     * respondendo "quem recebe".
     */
    donoFixoUserId?: string | null
}

/**
 * A política de um **canal**: a estratégia e, em `fixo`, a pessoa.
 *
 * ## Por que não é a política inteira
 *
 * Falta de propósito o `soDisponiveis`. Ele é **modificador da conta**, não do
 * canal: diz se a clínica distribui para quem está fora, e a resposta é da
 * operação dela, não do número por onde o paciente escreveu. O André fixou as
 * opções do canal em 26/11/2026 e são três — atendente específico, rodízio,
 * balanceamento —, sem variante de online; pôr o interruptor aqui dobraria a
 * lista para dizer o que a conta já diz uma vez.
 *
 * O par estratégia+pessoa viaja junto, e isso continua valendo: o canal que
 * escolhe `fixo` traz a pessoa dele, nunca a que sobrou na conta.
 */
export interface PoliticaDoCanal {
    estrategia: EstrategiaDeDistribuicao
    donoFixoUserId: string | null
}

export const POLITICA_PADRAO: PoliticaDeDistribuicao = {
    estrategia: 'nenhuma',
    soDisponiveis: false,
    donoFixoUserId: null,
}

/** As estratégias válidas, em um lugar só: o leitor e a rota conferem na mesma lista. */
export const ESTRATEGIAS: readonly EstrategiaDeDistribuicao[] = [
    'nenhuma',
    'rodizio',
    'balanceado',
    'fixo',
]

/**
 * Lê uma política de JSON. **Nunca lança; o pior caso é não distribuir.**
 *
 * Mora aqui, no módulo puro, porque agora tem **dois** depósitos: o
 * `Workspace.automations` da conta e o `AgentIntegration.distribuicao` da linha.
 * Duas validações para o mesmo formato discordariam na primeira estratégia nova
 * — e discordar aqui significa uma linha distribuindo por uma regra que a tela
 * da conta não sabe mostrar.
 *
 * Tudo que vem de JSON é desconhecido até ser conferido: estratégia inválida
 * vira `nenhuma` em vez de erro, porque configuração estragada não pode derrubar
 * o atendimento — só deixar de distribuir, que é visível na fila geral.
 */
/**
 * Lê a política de um canal. **`null` é "como na conta"**, e é a resposta a
 * tudo que não seja uma política legível.
 *
 * Aqui o lixo cai na herança, e não em `nenhuma` como no leitor da conta — a
 * diferença é intencional. A coluna do canal tem **um** significado, que é
 * "sobrescrevo a conta"; uma sobrescrita ilegível não é sobrescrita. Resolver
 * como `nenhuma` pararia a distribuição daquele canal em silêncio por causa de
 * um JSON torto, enquanto cair na conta mantém o atendimento andando por uma
 * regra que a clínica configurou e consegue ver.
 */
export function lerPoliticaDoCanal(valor: unknown): PoliticaDoCanal | null {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null

    const raw = valor as Record<string, unknown>
    if (!ESTRATEGIAS.includes(raw.estrategia as EstrategiaDeDistribuicao)) return null

    const estrategia = raw.estrategia as EstrategiaDeDistribuicao
    return {
        estrategia,
        // Só dentro de `fixo`, pela mesma razão do leitor da conta: id que
        // sobrasse de uma troca de estratégia voltaria a valer se alguém
        // devolvesse o canal para `fixo` meses depois.
        donoFixoUserId:
            estrategia === 'fixo' && typeof raw.donoFixoUserId === 'string' && raw.donoFixoUserId
                ? raw.donoFixoUserId
                : null,
    }
}

export function lerPolitica(valor: unknown): PoliticaDeDistribuicao {
    const raw = (valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {}) as Record<
        string,
        unknown
    >

    const estrategia = ESTRATEGIAS.includes(raw.estrategia as EstrategiaDeDistribuicao)
        ? (raw.estrategia as EstrategiaDeDistribuicao)
        : POLITICA_PADRAO.estrategia

    return {
        estrategia,
        soDisponiveis:
            typeof raw.soDisponiveis === 'boolean' ? raw.soDisponiveis : POLITICA_PADRAO.soDisponiveis,
        /**
         * Só faz sentido com `fixo`, e é guardado só nela. Um id que sobrasse de
         * uma troca de estratégia voltaria a valer se alguém devolvesse a linha
         * para `fixo` meses depois, escolhendo uma pessoa que ninguém reviu.
         */
        donoFixoUserId:
            estrategia === 'fixo' && typeof raw.donoFixoUserId === 'string' && raw.donoFixoUserId
                ? raw.donoFixoUserId
                : null,
    }
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
     * `minutosParaAusente` do argumento é o padrão do sistema; o do membro é a
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
 * O recorte de quem entra na lista de elegíveis — a parte que a estratégia
 * decide. Devolve o pedaço de `where` que a casca junta ao workspace e ao
 * `isActive`.
 *
 * ## A assimetria é a decisão, e tem razão
 *
 * | | departamento da linha | `recebeConversas` da pessoa |
 * |---|---|---|
 * | `fixo` | **ignora** | **obedece** |
 * | `rodizio` / `balanceado` | obedece | obedece |
 *
 * Departamento é roteamento padrão: a clínica que aponta a Fulana para o número
 * da ortodontia não quer saber se ela está naquele departamento. Nomear alguém
 * é mais específico que isso.
 *
 * `recebeConversas` é outra coisa: é a chave **da própria pessoa**, e quem a
 * desmarca está dizendo "não mandem conversa para ela". `fixo` passava por cima
 * dela até 26/11/2026, e o Andre bateu no caso homologando — a pessoa entra de
 * férias, alguém desmarca a caixa, e as conversas continuam chegando no canal
 * fixado nela. Marca que só vale às vezes é pior que marca nenhuma.
 *
 * Quando o recorte não acha ninguém, `escolherDono` devolve nulo e a conversa
 * vai para a **fila geral**. Nunca para o rodízio.
 *
 * `fixo` sem pessoa cai no recorte da fila de propósito: a decisão de não
 * escolher ninguém é de `escolherDono`, que já devolve nulo nesse caso, e
 * inventar aqui um filtro que não casa com ninguém espalharia a mesma regra por
 * dois lugares.
 */
export function recorteDeElegiveis(p: {
    estrategia: EstrategiaDeDistribuicao
    donoFixoUserId?: string | null
    departmentId: string | null
}): Record<string, unknown> {
    const fixo = p.estrategia === 'fixo' ? p.donoFixoUserId || null : null
    if (fixo) return { userId: fixo, recebeConversas: true }

    return {
        recebeConversas: true,
        ...(p.departmentId ? { departments: { some: { departmentId: p.departmentId } } } : {}),
    }
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

    if (politica.estrategia === 'fixo') {
        /**
         * A pessoa indicada, **se ela estiver na lista** — e a condição é o que
         * importa aqui.
         *
         * A lista já passou por workspace, `isActive` e pelo filtro de
         * disponibilidade. Então "não está na lista" cobre três casos reais com
         * uma resposta só: a pessoa saiu da clínica, foi desativada, ou está fora
         * com o interruptor ligado. Nos três a conversa vai para a fila geral em
         * vez de ficar presa em quem não pode atendê-la.
         *
         * **Não cai no rodízio.** A linha foi configurada para uma pessoa; virar
         * fila sozinha seria entregar o paciente a quem a clínica não escolheu, e
         * em silêncio. Fila geral é visível; rodízio escondido não.
         */
        const fixo = politica.donoFixoUserId
        if (!fixo) return null
        return candidatos.some((m) => m.userId === fixo) ? fixo : null
    }

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
