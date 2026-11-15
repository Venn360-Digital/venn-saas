import { vocab } from '../vocabulario'
import { comArtigo } from '../concordancia'
/**
 * O juiz do Andar 2: a rubrica, o prompt e a leitura do veredito.
 *
 * Parte pura. Quem chama o modelo é a rota de avaliação; aqui mora o que decide
 * **o que** se pergunta a ele e **como** a resposta é lida.
 *
 * ## Por que um juiz, e por que ele não é oráculo
 *
 * O Andar 1 (medição de recuperação) responde "o trecho certo chegou?" — barato,
 * determinístico, sem crédito. Ele não vê o que o agente **fez** com o trecho:
 * inventar um preço que não estava lá, ignorar a precedência, escrever três
 * parágrafos num WhatsApp. É para isso que o Andar 2 existe.
 *
 * E o juiz erra de formas conhecidas (ver *LLM-as-a-Judge Is Not an Oracle*,
 * 2026). As defesas estão espalhadas de propósito, cada uma no lugar onde o erro
 * aparece:
 *
 *   - **viés de posição** → `lib/avaliacao/pareado.ts` embaralha a ordem;
 *   - **viés de autopreferência** → o juiz é um modelo da mesma família que
 *     gera, por ora, e isso está **registrado como limitação**, não escondido: a
 *     segunda opinião de outra família entra quando houver um segundo provedor
 *     no gateway;
 *   - **nota inflada** → canário em `pareado.ts`: preferência perfeita é
 *     suspeita, não vitória;
 *   - **parser silencioso** → `interpretarVeredito` devolve `null` em vez de
 *     chutar. Veredito ilegível que vira "empate" é pior do que veredito
 *     perdido, porque entra na conta como dado.
 */

/**
 * Os critérios, na ordem em que o juiz os avalia.
 *
 * A ordem **é** a precedência do prompt do agente, e isso é deliberado: o juiz
 * lê os critérios na mesma hierarquia que o agente deveria ter obedecido. Um
 * agente que acertou o tom e inventou um preço perde, porque o critério do preço
 * vem antes.
 */
export const CRITERIOS = [
    {
        chave: 'fidelidade',
        titulo: 'Fiel aos trechos',
        pergunta:
            'A resposta se apoia no que os trechos recuperados dizem, sem acrescentar ' +
            'fato que não está lá?',
    },
    {
        chave: 'nao-inventou',
        titulo: 'Não inventou valor, horário ou prazo',
        pergunta:
            'A resposta cita algum preço, horário, prazo ou condição de pagamento que ' +
            'não aparece nos trechos nem nas instruções? Qualquer ocorrência reprova ' +
            'este critério.',
    },
    {
        chave: 'precedencia',
        titulo: 'Respeitou a precedência',
        pergunta:
            'Quando duas instruções se contradiziam, a resposta seguiu a de precedência ' +
            'maior (privacidade e limites antes de processo comercial e técnica de venda)?',
    },
    {
        chave: 'acao',
        titulo: 'Agiu certo',
        pergunta:
            'A resposta usou a ferramenta certa, ou passou o atendimento para a equipe ' +
            'quando devia? Prometer sem agir conta como errado.',
    },
    {
        chave: 'forma',
        titulo: 'Forma de WhatsApp',
        pergunta:
            'É mensagem curta, sem markdown, com no máximo uma pergunta, como alguém ' +
            'escreveria no WhatsApp?',
    },
    {
        chave: 'tom',
        titulo: 'Tom',
        pergunta: 'O tom combina com o que as instruções do agente pedem?',
    },
] as const

export type ChaveDeCriterio = (typeof CRITERIOS)[number]['chave']

/** O caso dourado: a pergunta, o que o agente tinha em mão, e o que se esperava. */
export interface CasoDourado {
    id: string
    pergunta: string
    /** Os trechos que a busca entregou, já com o caminho do cabeçalho. */
    trechos: string[]
    /**
     * A resposta que o instrutor aprovou ou corrigiu no console de ensaio.
     *
     * Nula quando o caso foi guardado só como pergunta — e aí o juiz compara as
     * duas respostas entre si, sem referência. Vale menos, mas vale: é a
     * comparação pareada que o estudo prefere à nota absoluta.
     */
    referencia: string | null
}

/**
 * O prompt do juiz.
 *
 * Três decisões de forma, todas medidas na literatura (§2.5 do estudo):
 *
 *   - **raciocínio critério a critério antes da nota.** Pedir o veredito primeiro
 *     faz o modelo escolher e depois justificar a escolha;
 *   - **A e B anônimos.** Nada no texto diz qual é o rascunho. O embaralho de
 *     `pareado.ts` é o que garante isso de verdade;
 *   - **saída fechada e no fim**, em uma linha que o parser acha. Pedir JSON
 *     inteiro aumenta a chance de o modelo quebrar a sintaxe e perder o
 *     raciocínio junto.
 */
export function promptDoJuiz(caso: CasoDourado, respostaA: string, respostaB: string): string {
    const trechos =
        caso.trechos.length > 0
            ? caso.trechos.map((t, i) => `[${i + 1}] ${t}`).join('\n\n')
            : '(a busca não trouxe nenhum trecho para esta pergunta)'

    const referencia = caso.referencia
        ? `\n## Resposta de referência, aprovada por uma pessoa\n${caso.referencia}\n`
        : ''

    const rubrica = CRITERIOS.map((c, i) => `${i + 1}. **${c.titulo}** — ${c.pergunta}`).join('\n')

    return [
        `Você avalia respostas de um agente de atendimento de ${vocab().organizacao} no WhatsApp.`,
        'Duas respostas, A e B, para a mesma pergunta. Diga qual é melhor.',
        '',
        `## Pergunta ${comArtigo(vocab(), 'pessoa', 'de')}`,
        caso.pergunta,
        '',
        '## O que o agente tinha em mão',
        trechos,
        referencia,
        '## Resposta A',
        respostaA,
        '',
        '## Resposta B',
        respostaB,
        '',
        '## Critérios, em ordem de precedência',
        rubrica,
        '',
        '## Como responder',
        'Primeiro percorra os critérios **na ordem**, um parágrafo curto cada, dizendo ' +
            'como A e B se comportam nele. Critério de precedência maior decide: só vá ao ' +
            'próximo quando os dois empatarem no anterior.',
        'Depois, na última linha e sozinha, escreva exatamente uma destas:',
        'VEREDITO: A',
        'VEREDITO: B',
        'VEREDITO: EMPATE',
    ].join('\n')
}

/** Quem o juiz preferiu, no rótulo cego que ele viu. */
export type VereditoCego = 'A' | 'B' | 'EMPATE'

/**
 * Lê o veredito da saída do juiz, ou devolve `null`.
 *
 * **`null` é resposta, não falha a esconder.** Um parser que chuta "empate"
 * quando não entende injeta dado inventado na métrica que decide se o
 * treinamento vai ao ar — é o modo de falha "parser silencioso" da literatura.
 * Quem chama conta os ilegíveis à parte e os mostra no relatório.
 *
 * A última ocorrência ganha: o juiz pode citar a palavra no meio do raciocínio
 * ("o veredito depende de..."), e o que vale é a linha final que foi pedida.
 */
export function interpretarVeredito(saida: string): VereditoCego | null {
    const achados = [...saida.matchAll(/VEREDITO:\s*(A|B|EMPATE)\b/gi)]
    if (achados.length === 0) return null

    const ultimo = achados[achados.length - 1][1].toUpperCase()
    return ultimo === 'A' || ultimo === 'B' ? ultimo : 'EMPATE'
}
