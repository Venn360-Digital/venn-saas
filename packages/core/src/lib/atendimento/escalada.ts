/**
 * Quando o agente não soube, e quando isso vira entrega à equipe.
 *
 * Parte pura: decide, não executa. Quem executa é o processador do `ai-reply`,
 * depois de a resposta já ter sido enviada — a decisão de escalar nunca atrasa
 * a mensagem que o paciente está esperando.
 *
 * ## Por que a detecção é determinística, e não uma pergunta ao modelo
 *
 * O caminho óbvio seria uma ferramenta `nao_encontrei` que o modelo chama
 * quando não sabe. Ela existe (ver `agent-tools.ts`), mas é a **segunda** rede,
 * não a primeira, por duas razões medidas:
 *
 *   - **modelo que não sabe também não sabe que não sabe.** Ele cumpre a
 *     instrução de "diga que vai confirmar com a equipe" e segue em frente; pedir
 *     que ele *além disso* registre a lacuna é pedir uma segunda decisão a quem
 *     já errou a primeira;
 *   - **custaria uma rodada a mais.** Cada chamada de ferramenta é uma ida ao
 *     modelo, cobrada do crédito da clínica (ver `MAX_RODADAS_DE_FERRAMENTA`).
 *     Pagar por mensagem para descobrir o que dois sinais que já temos em mão
 *     respondem de graça é o oposto do princípio 10 do estudo.
 *
 * Os dois sinais que já temos: **o que a busca trouxe** (com a similaridade de
 * cada trecho) e **o que o agente escreveu**. Lacuna é a conjunção dos dois —
 * busca fraca *e* resposta de quem não sabia. Exigir ambos é o que separa
 * "não havia material" de "havia material e o agente preferiu prometer
 * confirmação", que é caso de ferramenta, não de lacuna automática.
 */

/**
 * Os verbos de quem adia a resposta.
 *
 * Sozinhos não bastam: "vou confirmar seu horário de segunda" é uma frase boa,
 * de um agente que sabe exatamente o que está fazendo. Precisam de companhia —
 * ver `COMPANHIAS`.
 */
const VERBOS_DE_ADIAMENTO = ['confirmar', 'verificar', 'checar', 'consultar']

/**
 * O que transforma o verbo em "eu não sabia": um destino ou uma promessa de
 * volta. É a forma que a instrução `## Quando não souber` do prompt pede —
 * "diga que vai confirmar com a equipe e que retorna".
 */
const COMPANHIAS = ['com a equipe', 'com o time', 'com a recepcao', 'e retorno', 'e te retorno', 'e ja retorno']

/** Admissões diretas, que não precisam de verbo nem de companhia. */
const ADMISSOES = [
    'nao tenho essa informacao',
    'nao tenho esse dado',
    'nao tenho essa resposta',
    'nao sei informar',
    'nao consigo confirmar',
    'nao tenho como confirmar',
]

/**
 * Minúsculas e sem acento, para a comparação não depender de como o modelo
 * acentuou. `NFD` + corte dos diacríticos é a mesma normalização que o
 * `immutable_unaccent` faz no Postgres — ver a migração da busca sem acento.
 */
function normalizar(texto: string): string {
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
}

/**
 * A resposta é de quem não sabia?
 *
 * Verbo de adiamento **mais** companhia, ou uma admissão direta. A conjunção é
 * o que evita contar como lacuna a frase legítima de confirmação de um
 * horário que o agente acabou de marcar.
 */
export function pareceFallback(resposta: string): boolean {
    const t = normalizar(resposta)

    if (ADMISSOES.some((a) => t.includes(a))) return true

    const temVerbo = VERBOS_DE_ADIAMENTO.some((v) => t.includes(v))
    if (!temVerbo) return false

    return COMPANHIAS.some((c) => t.includes(c))
}

/** O que a lacuna precisa saber de cada trecho recuperado. */
export interface TrechoMedido {
    /** Ausente quando só a perna lexical achou a linha — ver o retriever. */
    similarity?: number
}

/**
 * A melhor similaridade do conjunto, ou nulo quando não há nenhuma.
 *
 * Nulo tem **dois** significados, e os dois contam como busca fraca: não veio
 * trecho nenhum, ou vieram trechos sem similaridade medida (achados só pelo
 * texto completo). O segundo caso nasceu com a busca híbrida: antes dela, todo
 * trecho devolvido tinha vetor e passava pelo piso.
 */
export function melhorSimilaridade(trechos: TrechoMedido[]): number | null {
    const medidas = trechos
        .map((t) => t.similarity)
        .filter((s): s is number => typeof s === 'number' && Number.isFinite(s))

    return medidas.length === 0 ? null : Math.max(...medidas)
}

export interface SinaisDaResposta {
    /** O que a busca entregou ao prompt desta resposta. */
    trechos: TrechoMedido[]
    /** O piso do atendimento — vem de `lib/rag/parametros.ts`, nunca cravado. */
    piso: number
    /** O texto que o paciente recebeu. */
    resposta: string
}

/**
 * Isto foi uma lacuna de conhecimento?
 *
 * Busca fraca **e** resposta de quem não sabia. Separado em duas perguntas de
 * propósito: cada uma sozinha tem falso positivo conhecido, e a conjunção não.
 *
 *   - busca fraca com resposta boa = o agente respondeu pelas instruções, que
 *     é o certo para pergunta de comportamento ("vocês atendem convênio?" pode
 *     estar nas instruções centrais, não no acervo);
 *   - busca forte com resposta de adiamento = havia material e o agente não o
 *     usou. É defeito, mas é **outro** defeito, e quem o registra é a
 *     ferramenta `nao_encontrei`, chamada pelo próprio modelo.
 */
export function ehLacuna(sinais: SinaisDaResposta): boolean {
    const melhor = melhorSimilaridade(sinais.trechos)
    const buscaFraca = melhor === null || melhor < sinais.piso
    return buscaFraca && pareceFallback(sinais.resposta)
}

/**
 * Quantas lacunas no mesmo atendimento antes de chamar gente.
 *
 * Dois, e não um: a primeira pergunta sem resposta é normal — nenhum acervo
 * cobre tudo, e prometer confirmação é exatamente o comportamento pedido. A
 * **segunda** diz que esta conversa saiu do que o agente sabe, e insistir é
 * fazer o paciente repetir pergunta para ouvir a mesma promessa.
 *
 * E não três: a terceira promessa de confirmação é o ponto em que o paciente
 * desiste, e aí a escalada chega tarde.
 */
export const LACUNAS_ATE_ESCALAR = 2

export interface SituacaoDaConversa {
    /** Lacunas registradas **neste** atendimento, incluindo a de agora. */
    lacunasNoAtendimento: number
    /** Já há humano no comando — por atribuição ou por entrega anterior. */
    jaEntregue: boolean
}

/**
 * Escalar agora?
 *
 * `jaEntregue` vem antes da contagem porque entregar duas vezes a mesma
 * conversa escreve duas notas internas e dispara duas notificações para a
 * mesma pessoa, sobre uma conversa que ela já tem na mão.
 */
export function deveEscalar(situacao: SituacaoDaConversa): boolean {
    if (situacao.jaEntregue) return false
    return situacao.lacunasNoAtendimento >= LACUNAS_ATE_ESCALAR
}

/** Por que a conversa foi entregue. Fechado, porque é o que o painel agrupa. */
export type MotivoDaEntrega =
    /** O modelo chamou `passar_para_equipe` — pedido do paciente ou decisão de cenário. */
    | 'ferramenta'
    /** Duas lacunas no mesmo atendimento. */
    | 'lacunas'
    /** Teto de respostas do agente neste atendimento. */
    | 'limite'
    /** Regra de ação com `notify_human`. */
    | 'regra'

/**
 * O destino genérico, quando o servico não disse para quem passar.
 *
 * "A nossa equipe" é a frase que serve a qualquer empresa e a qualquer motivo —
 * e era a única que existia até a área entrar.
 */
const EQUIPE = 'a nossa equipe'

/**
 * O teto da área citada na despedida.
 *
 * Sessenta caracteres cabem "o profissional que calcula o preço dessa peça" com
 * folga. O teto não é economia de token: é o que impede o modelo de escrever uma
 * frase inteira aqui e produzir uma despedida de duas orações emendadas, que é o
 * defeito que aparece quando texto livre do modelo entra no meio de uma frase
 * nossa.
 */
const LIMITE_DA_AREA = 60

/**
 * O que a área **não** pode dizer, e esta é a razão de a função existir.
 *
 * A entrega tem de ser imperceptível: o paciente sabe que foi para outra pessoa,
 * nunca que estava falando com um agente. Uma área escrita pelo modelo como
 * "um atendente humano" ou "o time de IA" entrega justamente isso — e entrega
 * numa frase que o produto montou, com a aparência de texto nosso.
 *
 * `\b` em volta de `ia` e de `ai` porque sem limite de palavra a lista reprova
 * "assistência" e "financeira" por conterem as duas letras no meio.
 */
const REVELA_A_AUTOMACAO =
    /\b(ia|ai|bot|bots|chatbot|robo|robot|humano|humana|humanos|humanas|maquina)\b|inteligencia artificial|virtual|automat/

/**
 * A área, limpa — ou nulo quando ela não serve e a despedida usa o genérico.
 *
 * Parte pura e exportada para ter prova própria: o que ela recusa é mais
 * importante do que o que ela aceita.
 */
export function areaDaDespedida(area?: string | null): string | null {
    const limpa = String(area ?? '')
        .replace(/\s+/g, ' ')
        .trim()

    if (!limpa) return null
    if (limpa.length > LIMITE_DA_AREA) return null
    if (REVELA_A_AUTOMACAO.test(normalizar(limpa))) return null

    return limpa
}

/**
 * A frase que o modelo devolve ao paciente quando a entrega acontece.
 *
 * `area` é opcional e vem do modelo, que a tira do servico da situação.
 * Sem ela — ou com uma que não passa em `areaDaDespedida` — a frase é a de
 * sempre.
 *
 * As duas variantes mudam só no fim, e a diferença não é estilo: com
 * responsável há alguém designado para responder, e sem responsável a conversa
 * está na fila geral, onde prometer uma pessoa específica seria promessa que o
 * produto não sustenta.
 */
export function despedidaDaEntrega(temResponsavel: boolean, area?: string | null): string {
    const destino = areaDaDespedida(area) ?? EQUIPE

    return temResponsavel
        ? `Já passei seu atendimento para ${destino} — alguém vai te responder por aqui.`
        : `Já passei seu atendimento para ${destino}, que continua por aqui com você.`
}
