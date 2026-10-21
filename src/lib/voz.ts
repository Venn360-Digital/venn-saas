/**
 * O texto que ensina o modelo a falar — e que **mora na aba Voz do agente**.
 *
 * As vozes da OpenAI são treinadas em inglês. As onze (alloy, nova, sage,
 * verse…) falam português por transferência, e é daí que vinha o sotaque que o
 * Andre chamou de robótico em 2026-10-20. O campo `instructions` do
 * `gpt-4o-mini-tts` não troca a voz, mas **puxa a pronúncia** quando a língua é
 * dita de forma explícita — e era só isso que faltava: o campo nascia vazio.
 *
 * **A instrução não é embutida no código na hora de falar.** Chegou a ser, e o
 * Andre recusou no mesmo dia: *"qualquer instrução do idioma deve ficar na TAB
 * de Voz do agente"*. Ele tem razão, e a razão é de produto — uma frase que
 * governa como o agente soa e que a clínica não vê é uma que ela não pode
 * ajustar, não pode reprovar e não entende por que não obedece. O que este
 * arquivo guarda é o **valor inicial** do campo, não um prefixo invisível.
 *
 * Então a regra é: quem fala usa o que está gravado no agente, e só isso. É
 * `semearEntonacao` que garante que nunca esteja vazio.
 */

/**
 * As vozes que a tela oferece, e a ordem em que ela as mostra.
 *
 * **São só as novas.** A lista tinha onze: as seis originais da OpenAI —
 * alloy, echo, fable, onyx, nova, shimmer — e as cinco de geração seguinte,
 * que nunca haviam chegado ao seletor. O Andre ouviu as onze no mesmo texto,
 * com a mesma instrução e o mesmo modelo, chamou as antigas de robóticas e
 * mandou removê-las em 2026-10-20. Oferecer uma voz que a própria casa
 * reprova é empurrar para a clínica a chance de soar mal.
 *
 * A lista mora aqui porque estava em dois lugares — a tela e a rota de amostra
 * —, e lista repetida é lista que diverge: a tela ofereceria uma voz que a
 * rota recusaria com 400, e o defeito apareceria como "a amostra não toca".
 *
 * **Nenhuma delas é brasileira.** Todas são treinadas em inglês e falam
 * português por transferência. A instrução de idioma puxa a pronúncia, não
 * troca a voz — ver `ENTONACAO_PADRAO`. Se um dia o sotaque for inaceitável, a
 * saída é outro fornecedor, não outra voz desta lista.
 */
export const VOZES = [
    { id: 'coral', nome: 'Coral', nota: 'Feminina, acolhedora e clara.' },
    { id: 'sage', nome: 'Sage', nota: 'Feminina, serena e madura.' },
    { id: 'ballad', nome: 'Ballad', nota: 'Feminina, suave e com mais emoção.' },
    { id: 'ash', nome: 'Ash', nota: 'Masculina, firme e objetiva.' },
    { id: 'verse', nome: 'Verse', nota: 'Masculina, expressiva.' },
] as const

export type VozId = (typeof VOZES)[number]['id']

export const VOZES_IDS = VOZES.map((v) => v.id) as [VozId, ...VozId[]]

/** A voz com que todo agente nasce — escolha do Andre em 2026-10-20. */
export const VOZ_PADRAO: VozId = 'coral'

/**
 * A voz do agente, caindo no padrão quando ela não existe mais.
 *
 * As seis antigas saíram do catálogo, e agente gravado com uma delas pediria
 * ao modelo uma voz que a tela não oferece — o seletor apareceria vazio e a
 * fala sairia com a voz reprovada. A migração no banco cobriu os de hoje;
 * isto cobre o que vier de backup, de importação ou de um registro que
 * escapou.
 */
export function vozValida(id?: string | null): VozId {
    return VOZES_IDS.includes(id as VozId) ? (id as VozId) : VOZ_PADRAO
}

/**
 * A entonação com que todo agente nasce — **uma frase, e só a língua**.
 *
 * Nasceu com seis frases, descrevendo papel, ritmo, pausas e o que não fazer.
 * O Andre ouviu e reprovou em 2026-10-20: *"essas pausas curtas não está
 * legal; deixe a IA trabalhar apenas com base nos parâmetros da TAB VOZ"*. E
 * ele está certo sobre o princípio, não só sobre a pausa: ritmo, calor e
 * registro **já têm campos na aba** — a voz escolhida e o Tom de voz. Prescrevê-los
 * de novo aqui é um segundo volante no mesmo carro, e quem perde é a clínica,
 * que mexe no seletor e não ouve diferença porque o texto manda mais.
 *
 * O que sobra é o que nenhum campo da aba cobre: **qual língua é essa**. As
 * onze vozes da OpenAI são treinadas em inglês e falam português por
 * transferência; sem esta frase, o sotaque é americano.
 */
export const ENTONACAO_PADRAO =
    'Fale em português do Brasil, com sotaque brasileiro neutro e pronúncia natural de falante nativo.'

/**
 * O Tom de voz da aba, dito ao modelo.
 *
 * **O seletor existia e não chegava a lugar nenhum.** A clínica escolhia entre
 * Prático, Formal, Casual e Amigável, a tela gravava em `voiceTone`, e quem
 * sintetizava a fala lia só o campo de entonação — o tom era decorativo para o
 * áudio desde que o recurso nasceu.
 *
 * Uma frase curta por tom, e nada além: o resto do jeito de falar é da voz
 * escolhida e do que a clínica escrever no campo.
 */
const TOM: Record<string, string> = {
    pratico: 'Tom prático e direto.',
    formal: 'Tom formal.',
    casual: 'Tom casual.',
    amigavel: 'Tom amigável e caloroso.',
}

/**
 * A instrução que vai ao modelo: o campo da aba, mais o tom da aba.
 *
 * Os dois vêm da aba Voz, que é de onde o Andre determinou que tudo deve vir.
 * O tom entra por último porque o modelo trata a instrução como direção de
 * cena, e a última frase pesa mais no ajuste fino.
 */
export function instrucaoDeFala(input: {
    entonacao?: string | null
    tom?: string | null
}): string | undefined {
    const partes = [input.entonacao?.trim(), input.tom ? TOM[input.tom] : undefined].filter(
        (p): p is string => Boolean(p)
    )
    return partes.length > 0 ? partes.join(' ') : undefined
}

export function semearEntonacao(doAgente?: string | null): string {
    return doAgente?.trim() || ENTONACAO_PADRAO
}
