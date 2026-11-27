import { ROTULO_DO_TIPO, ehTipoDeDocumento } from './estados'

/**
 * O estado da negociação em uma frase — **sem IA, de propósito**.
 *
 * ## Por que isto não usa modelo
 *
 * O plano do módulo listava "resumir o histórico de uma proposta" como o
 * terceiro uso de IA. Ao escrever, ficou claro que é o uso errado para um
 * modelo: **tudo que o resumo precisa dizer já está no banco, exato.** Quantas
 * versões, o que mudou no desconto, há quantos dias foi enviada, quantas vezes
 * o cliente abriu, quem aceitou e quando.
 *
 * Um modelo que recebe esses fatos e os reescreve em prosa pode errar um número,
 * e erraria de um jeito plausível — "aberta duas vezes" quando foram cinco. Num
 * resumo que alguém lê para decidir a próxima ligação, isso é pior que não ter
 * resumo. E custaria token por abertura de ficha.
 *
 * Então é uma função **pura**, determinística e testável, que monta a frase a
 * partir dos dados. A IA continua no módulo onde ela de fato acrescenta: propor
 * itens que ninguém escolheu ainda, e redigir texto que ninguém escreveu ainda
 * (ver `ia.ts`).
 *
 * ## Para quem isto é
 *
 * Para quem pega o negócio de outra pessoa — de férias, desligada, ou só porque
 * a conversa voltou depois de um mês. A linha do tempo está na tela em tabela;
 * esta frase é o que se lê em dois segundos antes de ligar.
 */

export interface FatosDaProposta {
    kind: string
    numero: number
    /** Quantas versões existem. */
    versoes: number
    /** O estado da revisão vigente. */
    estado: string
    /** O desconto da revisão vigente, em dinheiro. */
    desconto: number
    /** O desconto da PRIMEIRA versão, para dizer se ele cresceu. */
    descontoDaPrimeira: number | null
    /** Quando o link foi compartilhado pela primeira vez. */
    enviadaEm: Date | null
    aceitaEm: Date | null
    aceitaPor: string | null
    /** Aberturas somadas de todos os links da revisão vigente. */
    aberturas: number
    /** O prazo comercial, se houver. */
    validoAte: Date | null
}

const DIA_EM_MS = 86_400_000

/** "há 3 dias", "hoje", "ontem" — o jeito como uma pessoa diria. */
function haQuantosDias(quando: Date, agora: number): string {
    const dias = Math.floor((agora - quando.getTime()) / DIA_EM_MS)
    if (dias <= 0) return 'hoje'
    if (dias === 1) return 'ontem'
    return `há ${dias} dias`
}

/**
 * O resumo, em uma ou duas frases.
 *
 * `agora` entra por parâmetro, e não de `Date.now()` dentro: é o que torna a
 * função testável e o que a regra `react-hooks/purity` exige de qualquer coisa
 * que rode durante o render.
 */
export function resumirNegociacao(fatos: FatosDaProposta, agora: number = Date.now()): string {
    const rotulo = ROTULO_DO_TIPO[ehTipoDeDocumento(fatos.kind) ? fatos.kind : 'proposta']
    const partes: string[] = []

    // ── o que é, e quantas voltas deu ──
    if (fatos.versoes > 1) {
        partes.push(`${rotulo} ${fatos.numero}, na versão ${fatos.versoes}`)
        /**
         * O desconto que cresceu é o fato mais útil de uma renegociação.
         *
         * Quem pega o negócio de outro precisa saber que já se concedeu algo —
         * senão concede de novo, do zero, e o cliente leva duas vezes.
         */
        if (fatos.descontoDaPrimeira !== null && fatos.desconto > fatos.descontoDaPrimeira) {
            partes.push('com desconto maior que o da primeira')
        }
    } else {
        partes.push(`${rotulo} ${fatos.numero}`)
    }

    const primeira = partes.join(' ') + '.'
    const segunda: string[] = []

    // ── onde está ──
    if (fatos.aceitaEm) {
        segunda.push(
            `Aceita ${haQuantosDias(fatos.aceitaEm, agora)}${fatos.aceitaPor ? ` por ${fatos.aceitaPor}` : ''}`
        )
    } else if (fatos.estado === 'recusada') {
        segunda.push('O cliente recusou')
    } else if (fatos.estado === 'expirada') {
        segunda.push('O prazo venceu sem resposta')
    } else if (fatos.enviadaEm) {
        segunda.push(`Enviada ${haQuantosDias(fatos.enviadaEm, agora)}`)

        /**
         * A abertura é o dado que muda a próxima ligação, então vem junto do
         * envio e não numa frase à parte.
         *
         * Zero abertura **não** é "ele não gostou": é "ele não abriu". A frase
         * diz isso com as palavras que levam à ação certa.
         */
        if (fatos.aberturas === 0) {
            segunda.push('e ainda não foi aberta')
        } else if (fatos.aberturas === 1) {
            segunda.push('e aberta uma vez')
        } else {
            segunda.push(`e aberta ${fatos.aberturas} vezes`)
        }

        if (fatos.validoAte) {
            /**
             * `floor`, não `ceil` — são DIAS COMPLETOS que faltam.
             *
             * Com `ceil`, um prazo que vence em uma hora dizia "vence em 1
             * dia(s)": tecnicamente arredondado para cima, e errado para quem
             * lê — a pessoa deixaria para amanhã um documento que vence hoje. O
             * teste pegou.
             *
             * Com `floor`: 23 horas restantes dão 0 e saem como "vence hoje";
             * 25 horas dão 1. E vencido há uma hora dá -1, que cai no ramo do
             * "o prazo venceu".
             */
            const diasDePrazo = Math.floor((fatos.validoAte.getTime() - agora) / DIA_EM_MS)
            if (diasDePrazo < 0) segunda.push('— o prazo venceu')
            else if (diasDePrazo === 0) segunda.push('— o prazo vence hoje')
            else if (diasDePrazo <= 3)
                segunda.push(`— o prazo vence em ${diasDePrazo} ${diasDePrazo === 1 ? 'dia' : 'dias'}`)
        }
    } else {
        segunda.push('Ainda não foi enviada ao cliente')
    }

    // Colapsa espaço duplo (vem de um ramo que não acrescentou nada) e tira o
    // ponto que sobraria depois de um travessão.
    return `${primeira} ${segunda.join(' ')}.`.replace(/ {2,}/g, ' ')
}
