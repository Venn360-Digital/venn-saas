/**
 * A janela de expediente de uma regra — parte pura.
 *
 * ## Por que a janela vive na regra, e não numa configuração da conta
 *
 * Não existe horário comercial cadastrado em lugar nenhum do produto: o cron de
 * follow-up tem `9` e `18` cravados no arquivo, e o fuso é a constante
 * `FUSO_DO_NEGOCIO`. Criar uma tela de horário da clínica para atender a uma
 * condição de regra seria inventar uma configuração nova — e, pior, uma que
 * governaria coisas diferentes (o follow-up continuaria com os números dele).
 *
 * Com a janela dentro da condição, a regra se explica sozinha: quem lê
 * "fora de seg–sex 08:00–18:00" sabe o que vai acontecer, e a clínica que abre
 * sábado escreve a janela dela. O preço é que duas regras podem declarar janelas
 * diferentes; é um preço honesto, porque cada regra é um caso.
 *
 * ## A hora é a de parede, no fuso do negócio
 *
 * O Worker roda em UTC — `TZ` é ignorado (ver `lib/fuso.ts`). Então a condição
 * não compara horas de `Date`: compara `HH:MM` já convertido para o fuso do
 * negócio. "08:00" é oito da manhã em Brasília, que é o que a clínica combinou
 * com o paciente, e não oito em Londres.
 */

/** Os dias, para a tela e para a leitura de quem mexe nisto. 0 é domingo. */
export const DIAS_DA_SEMANA = [
    'Domingo',
    'Segunda',
    'Terça',
    'Quarta',
    'Quinta',
    'Sexta',
    'Sábado',
] as const

export interface JanelaDeExpediente {
    /** `HH:MM`, hora de parede no fuso do negócio. */
    inicio: string
    /** `HH:MM`. Exclusivo: às 18:00 em ponto já está fora de uma janela que fecha às 18:00. */
    fim: string
    /** Dias em que a janela vale. 0 é domingo. Vazio nunca está dentro. */
    dias: number[]
}

/** Seg–sex, 08:00–18:00: o que uma condição nova oferece antes de ser editada. */
export const JANELA_PADRAO: JanelaDeExpediente = {
    inicio: '08:00',
    fim: '18:00',
    dias: [1, 2, 3, 4, 5],
}

const HORA_MINUTO = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Lê o valor gravado na condição, e devolve `null` quando ele não serve.
 *
 * `conditions` é JSON livre: o valor pode chegar como objeto, como texto de uma
 * versão anterior da tela, ou pela API, que aceita `value: unknown`. Devolver
 * `null` em vez de um palpite é o que permite ao avaliador **não disparar** —
 * ver o comentário de `dentroDaJanela`.
 *
 * Recusa também janela invertida (`fim <= inicio`). Uma janela que atravessa a
 * meia-noite seria legítima num plantão, mas não é o que "expediente" quer dizer,
 * e aceitá-la em silêncio faria "fora do expediente" valer o dia inteiro.
 */
export function normalizarJanela(valor: unknown): JanelaDeExpediente | null {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null

    const bruto = valor as Record<string, unknown>
    const inicio = String(bruto.inicio ?? '')
    const fim = String(bruto.fim ?? '')

    if (!HORA_MINUTO.test(inicio) || !HORA_MINUTO.test(fim)) return null
    if (fim <= inicio) return null

    const dias = Array.isArray(bruto.dias)
        ? [...new Set(bruto.dias.map((d) => Number(d)))]
              .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
              .sort((a, b) => a - b)
        : []

    return { inicio, fim, dias }
}

/**
 * A hora de parede está dentro da janela?
 *
 * Comparação de texto `HH:MM` funciona porque os dois lados são zero-padded —
 * `'08:00' < '18:00'` é verdade em ordem lexicográfica. É mais barato e mais
 * fácil de ler que converter para minutos, e não tem como errar o fuso.
 *
 * O limite superior é **exclusivo**: numa janela 08:00–18:00, dezoito em ponto
 * já é fora. É o que casa com a leitura humana de "atendemos até as 18h".
 */
export function dentroDaJanela(
    horaMinuto: string,
    diaDaSemana: number,
    janela: JanelaDeExpediente
): boolean {
    if (!janela.dias.includes(diaDaSemana)) return false
    return horaMinuto >= janela.inicio && horaMinuto < janela.fim
}

/** `seg, ter, qua 08:00–18:00` — o resumo que a tela mostra ao lado do campo. */
export function descreverJanela(janela: JanelaDeExpediente): string {
    const dias = janela.dias.map((d) => DIAS_DA_SEMANA[d].slice(0, 3).toLowerCase())
    return `${dias.length > 0 ? dias.join(', ') : 'nenhum dia'} ${janela.inicio}–${janela.fim}`
}
