import type { Gatilho } from './gatilho'
import { vocab } from '../vocabulario'
import { comArtigo } from '../concordancia'

/**
 * Funis de partida — desenhos prontos que a pessoa ajusta.
 *
 * ## O que eles NÃO trazem
 *
 * **Texto de mensagem.** Nenhum. Cada passo de mensagem nasce com o assunto e
 * os blocos vazios, e o funil não publica sem conteúdo (`podePublicar` recusa
 * passo sem assunto por via do motor, e a tela marca o nó como incompleto).
 *
 * Isso é decisão, não preguiça. Um texto de partida escrito por nós sairia no
 * nome da clínica, prometendo o que nós não sabemos: preço, prazo, nome de
 * procedimento, condição de pagamento. É o mesmo raciocínio que já está
 * registrado na mineração de lacunas — a sugestão traz a pergunta e um branco
 * marcado, porque escrever a resposta seria inventar preço.
 *
 * **Alvo de gatilho.** `etiqueta_aplicada` sem `tagId`, porque a etiqueta é da
 * clínica. O funil nasce rascunho e a publicação cobra o alvo.
 *
 * ## As esperas têm números, e esses são nossos
 *
 * Intervalo não promete nada a ninguém — é ritmo, e ritmo ruim é o erro mais
 * comum de quem desenha o primeiro funil (três mensagens no mesmo dia). Então
 * os dias vêm preenchidos, e são o que uma sequência educada faz.
 */

export interface PassoDePartida {
    id: string
    type: string
    config: Record<string, unknown>
    order: number
    x: number
    y: number
    edges?: { padrao?: string; sim?: string; nao?: string } | null
}

export interface FunilDePartida {
    id: string
    nome: string
    descricao: string
    trigger: Gatilho
    maxAtivos: number | null
    passos: PassoDePartida[]
}

/** Uma coluna só, para o canvas abrir legível sem auto-layout. */
const COLUNA = 260
const LINHA = 150

const msg = (id: string, order: number, proximo?: string): PassoDePartida => ({
    id,
    type: 'mensagem',
    // `canal: 'email'` de propósito: o WhatsApp oficial está em revisão na Meta,
    // e um passo de partida que não pode sair seria um funil que nasce travado.
    config: { canal: 'email', assunto: '', blocos: [] },
    order,
    x: COLUNA,
    y: LINHA * order,
    edges: proximo ? { padrao: proximo } : null,
})

const espera = (id: string, order: number, dias: number, proximo?: string): PassoDePartida => ({
    id,
    type: 'espera',
    config: { dias },
    order,
    x: COLUNA,
    y: LINHA * order,
    edges: proximo ? { padrao: proximo } : null,
})

/**
 * Função memoizada, e não constante: o texto lê o vocabulário, e `BRAND()` é
 * fail-fast. Constante de módulo é avaliada quando a Cloudflare VALIDA o
 * script — sem requisição e sem marca registrada —, e a publicação reprova com
 * `MarcaNaoRegistradaError`. A forma que já reprovou cinco publicações.
 */
let galeriaDeFunisCache: FunilDePartida[] | null = null
export function GALERIA_DE_FUNIS(): FunilDePartida[] {
    if (galeriaDeFunisCache === null) galeriaDeFunisCache = [
    {
        id: 'boas-vindas',
        nome: 'Boas-vindas em três tempos',
        descricao: `Apresenta ${comArtigo(vocab(), 'organizacao')} a quem acabou de chegar, sem pressa.`,
        trigger: { tipo: 'contato_criado' },
        maxAtivos: null,
        passos: [
            msg('bv-1', 0, 'bv-e1'),
            espera('bv-e1', 1, 2, 'bv-2'),
            msg('bv-2', 2, 'bv-e2'),
            espera('bv-e2', 3, 4, 'bv-3'),
            msg('bv-3', 4),
        ],
    },
    {
        id: 'retorno',
        nome: 'Retorno de seis meses',
        descricao: 'Lembra quem não aparece há um tempo, e desiste depois de dois toques.',
        // Lista, então a publicação vai exigir o teto — e ele já vem preenchido
        // para a pessoa não ser barrada por uma regra que ainda não conhece.
        trigger: { tipo: 'entrou_na_lista' },
        maxAtivos: 200,
        passos: [msg('rt-1', 0, 'rt-e1'), espera('rt-e1', 1, 7, 'rt-2'), msg('rt-2', 2)],
    },
    {
        id: 'orcamento-parado',
        nome: 'Orçamento sem resposta',
        descricao:
            'Dois lembretes para quem recebeu orçamento e não respondeu. Para na hora em que a pessoa responde.',
        trigger: { tipo: 'etapa_do_negocio' },
        maxAtivos: null,
        passos: [
            msg('op-1', 0, 'op-e1'),
            espera('op-e1', 1, 3, 'op-cond'),
            {
                id: 'op-cond',
                type: 'condicao',
                config: { campo: 'respondeu' },
                order: 2,
                x: COLUNA,
                y: LINHA * 2,
                /**
                 * Respondeu → encerra. Não respondeu → o segundo toque.
                 *
                 * O ramo "sim" indo para `encerrar` é o ponto deste desenho: a
                 * pessoa respondeu, então o assunto saiu do automatismo e
                 * voltou para a equipe. Continuar mandando lembrete por cima de
                 * uma conversa viva é a pior coisa que um funil faz.
                 */
                edges: { sim: 'op-fim', nao: 'op-2' },
            },
            msg('op-2', 3, 'op-fim'),
            {
                id: 'op-fim',
                type: 'encerrar',
                config: {},
                order: 4,
                x: COLUNA,
                y: LINHA * 4,
                edges: null,
            },
        ],
    },
    {
        id: 'pos-atendimento',
        nome: 'Depois do atendimento',
        descricao: 'Agradece, pergunta como foi, e aplica a etiqueta de quem respondeu.',
        trigger: { tipo: 'etiqueta_aplicada' },
        maxAtivos: null,
        passos: [
            espera('pa-e1', 0, 1, 'pa-1'),
            msg('pa-1', 1, 'pa-e2'),
            espera('pa-e2', 2, 5, 'pa-cond'),
            {
                id: 'pa-cond',
                type: 'condicao',
                config: { campo: 'respondeu' },
                order: 3,
                x: COLUNA,
                y: LINHA * 3,
                // Sem aresta no "não": quem não respondeu termina ali, em
                // silêncio. É o certo — insistir depois de "como foi?" é
                // cobrança.
                edges: { sim: 'pa-tag' },
            },
            {
                id: 'pa-tag',
                type: 'etiquetar',
                config: {},
                order: 4,
                x: COLUNA,
                y: LINHA * 4,
                edges: null,
            },
        ],
    },
]
    return galeriaDeFunisCache
}
