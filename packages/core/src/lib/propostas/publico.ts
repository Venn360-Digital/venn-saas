import 'server-only'

import { dentroDoLimite, ipDaRequisicao } from '../limite'
import { pareceToken } from '../convite/token'
import { dinheiroEmTexto } from './calculo'
import { contextoDeMapa, contextoDeVariaveis } from './contexto'
import { renderDocumento } from './render'
import { converterCorpoEmSecoes, secoesPadrao, secoesSchema, type Secao } from './secoes'
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
    /** A cor principal do modelo (`#rrggbb`), ou nula para o tema. Fora do `html`: não entra no hash. */
    cor: string | null
    /** O logotipo da organização (URL), ou nulo. Também fora do `html`. */
    logo: string | null
}

/**
 * O documento, pronto para a página — e para o hash do aceite.
 *
 * Determinístico: nada de `new Date()` aqui dentro. É o que garante que o hash
 * gravado no aceite corresponda ao HTML que a pessoa tinha na tela, e não a uma
 * renderização com carimbo de outro instante.
 */
/** As seções que a página pública vai renderizar — congeladas, do modelo, ou o padrão. */
export function secoesDoCompartilhamento(share: DocumentoPublico): Secao[] {
    const revisao = share.revision
    const congeladas = secoesSchema.safeParse(revisao.sections)
    if (congeladas.success && congeladas.data.length > 0) return congeladas.data
    const doModelo = secoesSchema.safeParse(revisao.proposal.template?.sections)
    if (doModelo.success && doModelo.data.length > 0) return doModelo.data
    const c = converterCorpoEmSecoes(revisao.proposal.template?.body)
    return c.length > 0 ? c : secoesPadrao()
}

/**
 * @param urlDaCapa A URL pública da arte da capa, resolvida por quem chama
 * (`urlDaCapaDe(secoesDoCompartilhamento(share))`). Os dois chamadores — a
 * página e o aceite — têm de passar o mesmo, senão o hash do aceite não bate
 * com o que a pessoa viu.
 */
export function renderizarPublico(share: DocumentoPublico, urlDaCapa: string | null = null): DocumentoRenderizado {
    const revisao = share.revision
    const proposta = revisao.proposal
    const tipo = ehTipoDeDocumento(proposta.kind) ? proposta.kind : 'proposta'
    const moeda = proposta.currency

    /**
     * O congelado no envio manda; o vivo é a queda para revisão de antes da v2.
     *
     * Determinístico nos dois casos: nada de `new Date()`. É o que garante
     * que o hash do aceite corresponda ao HTML que a pessoa tinha na tela.
     */
    const secoes = secoesDoCompartilhamento(share)

    const variaveis =
        revisao.variableValues && typeof revisao.variableValues === 'object'
            ? contextoDeMapa(revisao.variableValues)
            : // Revisão enviada antes da v2, sem valores congelados: o contexto
              // vivo da v1 — nome do contato, da organização e do responsável.
              // Nada mais entra na projeção pública (ver `documentoPublico`).
              contextoDeVariaveis({
                  contato: { name: proposta.deal.contact?.name ?? null },
                  organizacao: { name: proposta.workspace.name },
                  documento: {
                      kind: proposta.kind,
                      number: proposta.number,
                      title: proposta.title,
                      createdAt: proposta.createdAt,
                      validUntil: revisao.validUntil,
                      subtotal: revisao.subtotal,
                      discount: revisao.discount,
                      total: revisao.total,
                      moeda,
                      /**
                       * `notes` da revisão NÃO entra aqui.
                       *
                       * É a observação interna do vendedor — "cliente pediu
                       * desconto, aprovei 10%" é o tipo de frase que mora ali.
                       * O que o cliente lê vem do modelo. É parte da projeção
                       * mínima — e por isso `notes` nem está no `select`.
                       */
                      observacao: null,
                  },
                  negocio: null,
                  responsavel: { name: proposta.createdBy?.name ?? null },
              })

    const html = renderDocumento({
        secoes,
        variaveis,
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
        urlDaCapa,
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
        cor: (proposta.template?.theme as { cor?: string | null } | null)?.cor ?? null,
        logo: proposta.workspace.logo ?? null,
    }
}
