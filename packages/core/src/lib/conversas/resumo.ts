import { vocab } from '../vocabulario'
import { comArtigo } from '../concordancia'
/**
 * A compactação da conversa: quando resumir, e com que prompt.
 *
 * Parte pura. Quem chama o modelo é a rota de resumo (pedido pela tela) e o
 * processador do `ai-reply` (automático, depois de enviar).
 *
 * ## Por que compactar, e por que não era preciso até agora
 *
 * A janela do prompt leva as últimas N mensagens. Numa conversa longa, o que
 * ficou de fora é justamente o que foi **combinado** — o procedimento escolhido,
 * o horário discutido, a restrição que a pessoa contou. O agente passa a
 * responder com a cauda e perde o acordo.
 *
 * Em produção isso ainda não aconteceu: a conversa mais longa tem 23 mensagens e
 * a mediana é 6. Então a compactação é **barata hoje e necessária depois**, e é
 * por isso que ela entra agora, antes de doer: quando doer, vai doer na conversa
 * mais valiosa da clínica, que é a longa.
 *
 * ## Por que não debita crédito
 *
 * O crédito é "uma ação de IA **entregue**" (ver `spendAiCredits`), e a
 * compactação não entrega nada a ninguém: ela conserta o contexto da resposta
 * seguinte. Cobrá-la faria a conversa longa custar mais por existir, sem o
 * cliente pedir nada. O custo real vai para `usage_logs`, que é onde a margem é
 * lida.
 *
 * O resumo **pedido pela tela** continua debitando: ali é uma pessoa pedindo e
 * recebendo um texto.
 */

/**
 * De quantas mensagens em diante a janela deixa de bastar.
 *
 * Trinta, e não vinte: a janela do prompt leva vinte, então compactar em vinte
 * resumiria exatamente o que ainda está na janela — trabalho e custo para
 * duplicar informação. Em trinta há dez mensagens fora da janela, que é o que o
 * resumo tem para contar.
 */
export const COMPACTAR_A_PARTIR_DE = 30

/**
 * Quantas mensagens novas até recalcular.
 *
 * Dez. Recalcular a cada mensagem seria uma chamada por mensagem numa conversa
 * longa — o dobro do custo do atendimento, para mudar uma vírgula no resumo. A
 * cada cinquenta, o resumo fica velho justamente durante a parte da conversa em
 * que as coisas são decididas.
 */
export const RECALCULAR_A_CADA = 10

export interface EstadoDaCompactacao {
    /** Mensagens da conversa, contadas no banco. */
    total: number
    /** Quantas chegaram depois da última compactação. Igual a `total` se nunca houve. */
    desdeOResumo: number
    /** Já existe resumo guardado? */
    temResumo: boolean
}

/**
 * Compactar agora?
 *
 * Duas condições, e as duas são necessárias. A primeira é "a janela já não
 * basta"; a segunda é "mudou o suficiente para valer a chamada".
 */
export function precisaCompactar(estado: EstadoDaCompactacao): boolean {
    if (estado.total < COMPACTAR_A_PARTIR_DE) return false
    if (!estado.temResumo) return true
    return estado.desdeOResumo >= RECALCULAR_A_CADA
}

/** O modelo da compactação: o barato da família. Tarefa interna, não é o que o cliente lê. */
export const MODELO_DO_RESUMO = 'gpt-4o-mini'

/** Quantas mensagens o resumo lê. O começo da conversa é onde está o pedido. */
export const JANELA_DO_RESUMO = 120

/**
 * O prompt do resumo — **um só, para os dois chamadores**.
 *
 * Era uma constante dentro da rota, e a compactação automática precisava do
 * mesmo texto. Duas cópias divergiriam na primeira vez que alguém melhorasse uma
 * delas, e aí o resumo que a tela mostra e o que o agente lê passariam a
 * descrever a mesma conversa de formas diferentes — sem ninguém notar, porque
 * ninguém olha os dois lado a lado.
 *
 * As quatro seções com rótulo fixo não são formatação: é o que permite o passado
 * da conversa entrar no prompt do agente como estado, em vez de prosa.
 */
export /**
 * Função memoizada, e não constante: o texto lê o vocabulário, e `BRAND()` é
 * fail-fast. Constante de módulo é avaliada quando a Cloudflare VALIDA o
 * script — sem requisição e sem marca registrada — e a publicação reprova com
 * `MarcaNaoRegistradaError`. O `check:marca-tardia` apontou este arquivo no
 * instante em que o vocabulário entrou no prompt.
 */
let systemDoResumoCache: string | null = null
export function systemDoResumo(): string {
    if (systemDoResumoCache === null) systemDoResumoCache = `Você resume conversas de atendimento de ${comArtigo(vocab(), 'organizacao', 'um')} odontológica para a própria equipe.
Escreva em português do Brasil, direto, sem saudação e sem repetir o que o atendente já sabe.
Responda exatamente nestas quatro seções, cada uma começando pelo rótulo seguido de ":".
Resumo: dois a três períodos sobre o que ${comArtigo(vocab(), 'pessoa')} quer e onde o atendimento parou.
Pendências: tópicos com "- ", o que falta fazer. Escreva "- Nenhuma" se não houver.
Combinados: tópicos com "- ", datas, valores e ${vocab().servicos} acordados. Escreva "- Nenhum" se não houver.
Tom: uma linha sobre o estado ${comArtigo(vocab(), 'pessoa', 'de')} (apressado, inseguro, satisfeito, irritado).
Não invente datas, valores ou ${vocab().servicos} que não estejam na conversa.
Os agendamentos já marcados chegam prontos na primeira linha da entrada: use-os para não listar como pendência algo que já está marcado, e não os repita em "Combinados".`
    return systemDoResumoCache
}

export interface MensagemParaTranscrever {
    direction: string
    content: string | null
    transcript: string | null
    contentType: string
    createdAt: Date
}

/**
 * A transcrição que o resumo lê, em ordem cronológica.
 *
 * Áudio entra pela **transcrição**: sem isso o resumo veria `[audio]` e a
 * conversa de quem só manda nota de voz resumiria como uma sequência de nada.
 */
export function transcrever(mensagens: MensagemParaTranscrever[]): string {
    return mensagens
        .map((m) => {
            const quem = m.direction === 'inbound' ? `${vocab().Pessoa}` : `${vocab().Organizacao}`
            const corpo = m.transcript?.trim() || m.content?.trim() || `[${m.contentType}]`
            const quando = m.createdAt.toISOString().slice(0, 10)
            return `${quando} ${quem}: ${corpo}`
        })
        .join('\n')
}

/**
 * O resumo guardado, no formato em que ele entra no prompt do agente.
 *
 * Devolve `null` para resumo vazio, para a seção não ser emitida com cabeçalho e
 * nada embaixo.
 *
 * Vai **antes da janela** de histórico: é o que aconteceu antes do que o agente
 * está vendo, e pô-lo depois faria o modelo ler o passado como se fosse a última
 * coisa dita.
 */
export function resumoParaOPrompt(texto: string | null): string | null {
    const limpo = texto?.trim()
    if (!limpo) return null

    return (
        '## O que já aconteceu nesta conversa\n' +
        'Resumo das mensagens anteriores às que você está vendo. Trate os combinados ' +
        'como já ditos — não os repita como se fossem novidade.\n\n' +
        limpo
    )
}
