import { vocab } from './vocabulario'
import { comArtigo } from './concordancia'
import { BRAND } from '../marca'
/**
 * The agreement shown on the last step of onboarding.
 *
 * Versioned, because an acceptance that does not say *what* was accepted proves
 * nothing. Bump the version whenever the text changes in substance, and the
 * record of who accepted which wording survives.
 */
export const TERMS_VERSION = '2026-10-07'

export interface TermsSection {
    title: string
    body: string[]
}

/**
 * Função memoizada, e não constante: o texto lê o vocabulário, e `BRAND()` é
 * fail-fast. Constante de módulo é avaliada quando a Cloudflare VALIDA o
 * script — sem requisição e sem marca registrada —, e a publicação reprova com
 * `MarcaNaoRegistradaError`. A forma que já reprovou cinco publicações.
 */
let termsCache: TermsSection[] | null = null
export function TERMS(): TermsSection[] {
    if (termsCache === null) termsCache = [
    {
        title: 'Período de avaliação',
        body: [
            'Você tem 7 dias de avaliação gratuita, contados a partir do seu cadastro e encerrando às 23:59 do sétimo dia, no horário de Brasília.',
            'A avaliação inclui 1.000 créditos de IA para validar o seu agente de atendimento. Não é necessário cartão de crédito, e nada é cobrado até você efetivar uma assinatura.',
        ],
    },
    {
        title: 'Créditos de IA',
        body: [
            `Um crédito corresponde ao custo real de processamento do modelo de linguagem. Quando os créditos acabam, o agente para de responder automaticamente e avisa ${comArtigo(vocab(), 'pessoa')} de que o atendimento continuará em instantes — as mensagens seguem chegando e a equipe continua respondendo normalmente.`,
            'Os créditos do plano são renovados a cada 30 dias contados da contratação e não se acumulam de um período para o outro. Créditos avulsos, quando adquiridos, valem 90 dias a partir da compra ou até se esgotarem.',
            'A compra de créditos avulsos exige um plano ativo e estar fora do período de avaliação.',
        ],
    },
    {
        title: 'Ao fim da avaliação',
        body: [
            'Se nenhum plano for contratado até o fim dos 7 dias, o workspace passa a somente-leitura: todo o histórico continua acessível, as mensagens continuam chegando pelo WhatsApp e a exportação dos dados permanece disponível.',
            'O que fica suspenso é o envio de mensagens e a criação de novos registros. Contratar um plano restabelece tudo imediatamente, sem reconectar o WhatsApp.',
        ],
    },
    {
        title: 'Limites do plano',
        body: [
            'Cada plano define quantos agentes de IA e quantos números de WhatsApp podem estar ativos. Usuários são ilimitados em todos os planos.',
            'Ao migrar para um plano menor, os agentes e números excedentes são pausados do mais recente para o mais antigo. Nada é apagado: eles voltam ao normal quando o plano comportá-los.',
        ],
    },
    {
        title: 'Seus dados',
        body: [
            `${comArtigo(vocab(), 'Organizacao')} é a controladora dos dados dos seus ${vocab().pessoas}; o ${BRAND().name} atua como operador, nos termos da LGPD.`,
            'Encerrada a avaliação sem contratação, os dados ficam disponíveis para consulta e exportação por 90 dias. Você recebe aviso 60 dias antes e novamente 7 dias antes da exclusão definitiva.',
            'A exportação está disponível a qualquer momento, inclusive durante o período de somente-leitura.',
        ],
    },
]
    return termsCache
}
