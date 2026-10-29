import { ehMarcadorDeMidia } from '@/lib/whatsapp/payload'

/**
 * O texto com que se procura no Cérebro.
 *
 * Era `lastInbound.content` cru, e isso errava de duas formas — a primeira
 * grave, a segunda frequente:
 *
 *   - **Nota de voz procurava por "🎵 Áudio".** O decodificador grava esse
 *     marcador no `content` e põe a fala em `transcript`. A string do marcador
 *     não se parece com nada do acervo, então com o piso de similaridade a
 *     busca voltava **vazia**: quem mandava áudio era atendido sem preço, sem
 *     serviço e sem FAQ. O agente respondia — só respondia pior —, e por isso
 *     o defeito atravessou o lançamento da voz sem ninguém ver.
 *   - **A pergunta de WhatsApp quase nunca se sustenta sozinha.** "E quanto
 *     custa?" são três palavras sem assunto; o vetor delas não aponta para
 *     lugar nenhum do acervo. O assunto está nas mensagens anteriores **da
 *     própria pessoa**.
 *
 * Daí as duas regras: usar a transcrição quando é áudio, e **completar a
 * pergunta curta com o que a pessoa já disse**.
 *
 * **Só o que ela escreveu, nunca o que o agente respondeu.** A resposta do
 * agente carrega os trechos que já foram recuperados, então incluí-la faria a
 * busca convergir para o que ela mesma trouxe na rodada anterior — um laço que
 * se reforça e nunca descobre assunto novo. O custo dessa escolha é honesto:
 * quando o referente está na pergunta do agente ("qual dos dois?" → "o
 * primeiro"), a expansão não ajuda. Perde-se um caso raro para não criar um
 * defeito sistemático.
 *
 * Nada aqui chama modelo. Reescrever a pergunta com um LLM daria um pouco mais,
 * e custaria uma chamada por mensagem — em latência e em margem, já que o
 * crédito do cliente é por ação entregue e não por consumo. Concatenar resolve o
 * caso dominante de graça, e é determinístico, então é exercitável.
 */

export interface MensagemDaConversa {
    direction: string
    content: string
    contentType?: string | null
    transcript?: string | null
    isInternal?: boolean | null
}

/**
 * Acima deste tamanho, a mensagem se explica e o contexto só dilui o vetor.
 *
 * O risco de expandir sempre é real: juntar 400 caracteres de assunto antigo a
 * uma pergunta longa e clara desloca o vetor para a média dos dois.
 *
 * **É um proxy, e vale dizer para quem for mexer.** O que se quer saber é se a
 * mensagem nomeia um assunto, e tamanho é o sinal mais simples disso: quem
 * escreve 120 caracteres já disse do que está falando. Começou em 180 e desceu
 * ao calibrar os casos — uma pergunta de 149 ("atendem pelo convênio Amil e
 * qual o valor de uma avaliação com panorâmica?") se explica inteira e ainda
 * recebia contexto. O erro na direção oposta é barato: juntar "oi" a uma
 * pergunta clara é ruído de dois caracteres.
 */
const AUTOSSUFICIENTE = 120

/** Quanto de passado cabe. Mais que isto e a pergunta atual perde o peso. */
const TETO_DE_CONTEXTO = 400

/**
 * O que dá para procurar nesta mensagem — vazio quando não há palavra dela.
 *
 * Áudio vale pela transcrição; áudio sem transcrição (a transcrição falhou, ou
 * ainda não rodou) não vale nada, e é melhor cair no contexto anterior do que
 * procurar pelo marcador.
 */
export function textoParaBusca(mensagem: MensagemDaConversa): string {
    if (mensagem.contentType === 'audio') return mensagem.transcript?.trim() ?? ''
    const texto = mensagem.content?.trim() ?? ''
    return ehMarcadorDeMidia(texto) ? '' : texto
}

/**
 * Monta a consulta a partir do histórico, em ordem cronológica.
 *
 * A pergunta atual vem **primeiro**, e o contexto depois: o que importa é a
 * massa de texto, e a atual precisa dominar o vetor.
 */
export function montarConsulta(historico: MensagemDaConversa[]): string {
    const dela = historico.filter(
        (m) => m.direction === 'inbound' && !m.isInternal && textoParaBusca(m).length > 0
    )

    const atual = dela.at(-1)
    if (!atual) return ''

    const texto = textoParaBusca(atual)
    if (texto.length >= AUTOSSUFICIENTE) return texto

    const anteriores: string[] = []
    let orcamento = TETO_DE_CONTEXTO
    const vistos = new Set([texto])

    // De trás para frente: o passado recente explica a pergunta melhor que o
    // começo da conversa.
    for (let i = dela.length - 2; i >= 0 && orcamento > 0; i--) {
        const anterior = textoParaBusca(dela[i])
        // Mandar "oi" três vezes não deve gastar o orçamento três vezes.
        if (vistos.has(anterior)) continue
        vistos.add(anterior)
        anteriores.push(anterior.slice(0, orcamento))
        orcamento -= anterior.length
    }

    return [texto, ...anteriores].join('\n')
}
