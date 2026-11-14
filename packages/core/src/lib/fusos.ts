/**
 * Os fusos que o agente pode usar para saber que horas são.
 *
 * ## Por que a lista cresceu
 *
 * Eram quatro, todos do Brasil, com o comentário "é onde o produto atende". Ele
 * deixou de valer em duas frentes ao mesmo tempo: o Andre pediu Sydney, e o
 * mesmo código roda hoje em três produtos — dois deles genéricos, sem recorte
 * de país. Um agente que atende de outro fuso respondia "amanhã às 9h" contando
 * pelo relógio de Brasília.
 *
 * ## Por que o rótulo é calculado, e não escrito
 *
 * Porque a diferença muda duas vezes por ano. "Sydney (GMT+10)" fica errado de
 * outubro a abril, quando lá é GMT+11, e "Nova York (GMT−5)" fica errado metade
 * do ano. Escrever o número à mão garante que metade da lista esteja mentindo
 * em qualquer dia do ano — e o fuso é justamente o campo em que a conta vai
 * conferir o número antes de escolher.
 *
 * `Intl` já sabe disso e está no runtime dos três lugares onde isto roda
 * (navegador, Node e workerd). Fuso desconhecido cai no nome da cidade sem o
 * sufixo, em vez de derrubar a tela.
 */

export interface Fuso {
    value: string
    /** A cidade, como a pessoa a procura. O deslocamento é acrescentado na tela. */
    cidade: string
}

export interface GrupoDeFusos {
    titulo: string
    fusos: Fuso[]
}

/**
 * Brasil primeiro, e inteiro: é de onde vem a conta que abre o produto hoje, e
 * os quatro fusos oficiais cabem numa olhada. O resto é por região, na ordem em
 * que um brasileiro procuraria.
 */
export const GRUPOS_DE_FUSOS: GrupoDeFusos[] = [
    {
        titulo: 'Brasil',
        fusos: [
            { value: 'America/Sao_Paulo', cidade: 'Brasília, São Paulo' },
            { value: 'America/Manaus', cidade: 'Manaus, Cuiabá' },
            { value: 'America/Rio_Branco', cidade: 'Rio Branco' },
            { value: 'America/Noronha', cidade: 'Fernando de Noronha' },
        ],
    },
    {
        titulo: 'Américas',
        fusos: [
            { value: 'America/Argentina/Buenos_Aires', cidade: 'Buenos Aires' },
            { value: 'America/Santiago', cidade: 'Santiago' },
            { value: 'America/Bogota', cidade: 'Bogotá, Lima' },
            { value: 'America/Mexico_City', cidade: 'Cidade do México' },
            { value: 'America/New_York', cidade: 'Nova York, Miami' },
            { value: 'America/Chicago', cidade: 'Chicago' },
            { value: 'America/Denver', cidade: 'Denver' },
            { value: 'America/Los_Angeles', cidade: 'Los Angeles' },
        ],
    },
    {
        titulo: 'Europa e África',
        fusos: [
            { value: 'Europe/Lisbon', cidade: 'Lisboa' },
            { value: 'Europe/London', cidade: 'Londres, Dublin' },
            { value: 'Europe/Madrid', cidade: 'Madri, Paris, Roma' },
            { value: 'Europe/Berlin', cidade: 'Berlim, Amsterdã' },
            { value: 'Europe/Athens', cidade: 'Atenas, Helsinque' },
            { value: 'Africa/Luanda', cidade: 'Luanda' },
            { value: 'Africa/Maputo', cidade: 'Maputo' },
            { value: 'Africa/Johannesburg', cidade: 'Joanesburgo' },
        ],
    },
    {
        titulo: 'Ásia e Oceania',
        fusos: [
            { value: 'Asia/Dubai', cidade: 'Dubai' },
            { value: 'Asia/Kolkata', cidade: 'Mumbai, Nova Délhi' },
            { value: 'Asia/Bangkok', cidade: 'Bangkok, Jacarta' },
            { value: 'Asia/Shanghai', cidade: 'Xangai, Hong Kong' },
            { value: 'Asia/Tokyo', cidade: 'Tóquio, Seul' },
            { value: 'Australia/Perth', cidade: 'Perth' },
            { value: 'Australia/Brisbane', cidade: 'Brisbane' },
            { value: 'Australia/Sydney', cidade: 'Sydney, Melbourne' },
            { value: 'Pacific/Auckland', cidade: 'Auckland' },
        ],
    },
]

/** Todo fuso da lista, achatado — para procurar um valor gravado. */
export const FUSOS = GRUPOS_DE_FUSOS.flatMap((g) => g.fusos)

/** `America/Sao_Paulo` → `GMT−3` **hoje**, com horário de verão incluído. */
export function deslocamentoDe(timeZone: string, agora: Date = new Date()): string {
    try {
        const parte = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
            .formatToParts(agora)
            .find((p) => p.type === 'timeZoneName')?.value
        // `GMT-3` vem com hífen-menos ASCII; o sinal tipográfico é o que o
        // resto da interface usa para número negativo.
        return parte ? parte.replace('-', '−') : ''
    } catch {
        return ''
    }
}

/** O rótulo completo: `Sydney, Melbourne (GMT+11)`. */
export function rotuloDoFuso(fuso: Fuso, agora: Date = new Date()): string {
    const off = deslocamentoDe(fuso.value, agora)
    return off ? `${fuso.cidade} (${off})` : fuso.cidade
}

/**
 * O rótulo a partir do valor **gravado**, que é o que o banco devolve.
 *
 * `rotuloDoFuso` pede o objeto da lista; quem leu uma coluna tem só a string.
 * Valor fora da lista volta como está — a tela mostra `Pacific/Chatham` em vez
 * de ficar em branco, e fica evidente o que arrumar.
 */
export function rotuloDoValor(value: string, agora: Date = new Date()): string {
    const achado = FUSOS.find((f) => f.value === value)
    return achado ? rotuloDoFuso(achado, agora) : value
}
