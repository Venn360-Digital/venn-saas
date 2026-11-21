import 'server-only'

import { dentroDoLimite, ipDaRequisicao } from '../limite'
import { pareceToken } from '../convite/token'
import { dinheiroEmTexto } from './calculo'
import { renderDocumento } from './render'
import { ROTULO_DO_TIPO, ehTipoDeDocumento } from './estados'
import type { DocumentoPublico } from './compartilhar'

/**
 * O que a rota pública precisa, fora do banco.
 *
 * Separado da página e da rota de aceite porque as duas fazem exatamente os
 * mesmos testes de abuso e montam o mesmo HTML — e se o aceite renderizasse
 * diferente da leitura, o hash gravado não corresponderia ao que a pessoa viu.
 */

/** Aberturas por IP numa hora. Generoso: a pessoa recarrega, mostra a alguém. */
const TETO_POR_IP = 60
/** Aberturas de um mesmo token numa hora. */
const TETO_POR_TOKEN = 120
/** Tentativas de aceite por IP numa hora. Apertado: aceitar é ato único. */
const TETO_DE_ACEITE = 10

const JANELA_EM_SEGUNDOS = 60 * 60

/**
 * O teste de abuso, por IP **e** por token.
 *
 * Os dois eixos, e nenhum basta sozinho: só por IP, quem varre tokens de uma
 * botnet passa; só por token, quem varre um token diferente por tentativa
 * passa. Juntos, varrer fica caro dos dois lados.
 */
export async function dentroDoLimitePublico(
    request: Request,
    token: string,
    acao: 'abrir' | 'aceitar'
): Promise<boolean> {
    const ip = ipDaRequisicao(request)
    const teto = acao === 'aceitar' ? TETO_DE_ACEITE : TETO_POR_IP

    const [porIp, porToken] = await Promise.all([
        dentroDoLimite(`proposta:${acao}:ip:${ip}`, teto, JANELA_EM_SEGUNDOS),
        dentroDoLimite(`proposta:${acao}:token:${token}`, TETO_POR_TOKEN, JANELA_EM_SEGUNDOS),
    ])

    return porIp && porToken
}

/**
 * O token tem a forma de um token nosso?
 *
 * Checagem de forma antes de ir ao banco — `/p/undefined` é o que um link
 * truncado produz, e não merece uma consulta. **Não é segurança**: a segurança
 * é o token não existir na tabela. É higiene, e é a mesma nota de
 * `lib/convite/token.ts`.
 */
export { pareceToken }

/** O user-agent, cortado no tamanho da coluna de trilha. */
export function userAgentDaRequisicao(request: Request): string | null {
    const ua = request.headers.get('user-agent')
    if (!ua) return null
    return ua.slice(0, 500)
}

export interface DocumentoRenderizado {
    html: string
    titulo: string
    rotulo: string
    numero: number
    organizacao: string
    totalEmTexto: string
    aceitoEm: Date | null
    aceitoPor: string | null
    expiraEm: Date
    validoAte: Date | null
}

/**
 * O documento, pronto para a página — e para o hash do aceite.
 *
 * Determinístico: nada de `new Date()` aqui dentro. É o que garante que o hash
 * gravado no aceite corresponda ao HTML que a pessoa tinha na tela, e não a uma
 * renderização com carimbo de outro instante.
 */
export function renderizarPublico(share: DocumentoPublico): DocumentoRenderizado {
    const revisao = share.revision
    const proposta = revisao.proposal
    const tipo = ehTipoDeDocumento(proposta.kind) ? proposta.kind : 'proposta'
    const moeda = proposta.currency

    const html = renderDocumento({
        corpo: proposta.template?.body,
        variaveis: {
            cliente: proposta.deal.contact?.name ?? null,
            organizacao: proposta.workspace.name,
            numero: `${ROTULO_DO_TIPO[tipo]} ${proposta.number}`,
            titulo: proposta.title,
            data: proposta.createdAt.toLocaleDateString('pt-BR'),
            validade: revisao.validUntil
                ? `Válida até ${revisao.validUntil.toLocaleDateString('pt-BR')}`
                : null,
            total: dinheiroEmTexto(revisao.total, moeda),
            subtotal: dinheiroEmTexto(revisao.subtotal, moeda),
            // Desconto zero sai vazio: o marcador desaparece e leva a pontuação
            // órfã com ele, em vez de imprimir "Desconto: R$ 0,00".
            desconto: revisao.discount.isZero() ? null : dinheiroEmTexto(revisao.discount, moeda),
            responsavel: proposta.createdBy?.name ?? null,
            /**
             * `notes` da revisão NÃO entra aqui.
             *
             * É a observação interna do vendedor — "cliente pediu desconto,
             * aprovei 10%" é o tipo de frase que mora ali. O que o cliente lê
             * vem do template. É parte da projeção mínima.
             */
            observacao: null,
            profissional: null,
        },
        itens: revisao.items.map((i) => ({
            description: i.description,
            quantity: i.quantity.toString(),
            unitPrice: i.unitPrice.toString(),
            discountPct: i.discountPct.toString(),
            total: i.total.toString(),
            unit: i.productService?.unit ?? null,
        })),
        totais: { subtotal: revisao.subtotal, discount: revisao.discount, total: revisao.total },
        moeda,
    })

    return {
        html,
        titulo: proposta.title,
        rotulo: ROTULO_DO_TIPO[tipo],
        numero: proposta.number,
        organizacao: proposta.workspace.name,
        totalEmTexto: dinheiroEmTexto(revisao.total, moeda),
        aceitoEm: share.acceptedAt,
        aceitoPor: share.acceptedByName,
        expiraEm: share.expiresAt,
        validoAte: revisao.validUntil,
    }
}
