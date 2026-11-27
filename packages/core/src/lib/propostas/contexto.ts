import type { Prisma } from '@venn/db'

import { dinheiroEmTexto } from './calculo'
import { ROTULO_DO_TIPO, ehTipoDeDocumento } from './estados'
import {
    achatarVariaveis,
    GRUPOS,
    variaveisPersonalizadas,
    type ContextoDeVariaveis,
    type Grupo,
} from './variaveis'

/**
 * O contexto de variáveis de um documento — montado num lugar só.
 *
 * ## Por que um montador, e não cada rota montando o seu
 *
 * Três lugares precisam dos mesmos valores: a prévia no editor, a página
 * pública e o congelamento no envio. Três montagens divergiriam na primeira
 * formatação de data, e o hash do aceite (que é do HTML) deixaria de bater
 * com o que a prévia mostrou. Um montador, três chamadores.
 *
 * ## Os valores já chegam **formatados**
 *
 * `documento.total` é "R$ 9.600,00", não `9600`. A variável é texto que entra
 * no meio de uma frase, e quem escreve o modelo não deveria ter de formatar
 * dinheiro nem data. A formatação é pt-BR porque o produto é.
 *
 * ## Congelar e descongelar
 *
 * `congelarVariaveis` achata o contexto no mapa plano que a revisão guarda em
 * `variableValues`; `contextoDeMapa` faz o caminho de volta. É o par que
 * garante que a proposta de ontem mostre o telefone de ontem.
 */

type Dinheiro = string | number | Prisma.Decimal

export interface EntradaDoContexto {
    contato?: {
        name?: string | null
        phone?: string | null
        email?: string | null
        customFields?: unknown
    } | null
    organizacao: {
        name: string
        cnpj?: string | null
        address?: string | null
        phone?: string | null
    }
    documento: {
        kind: string
        number: number
        title: string
        createdAt: Date
        validUntil?: Date | null
        subtotal: Dinheiro
        discount: Dinheiro
        total: Dinheiro
        moeda: string
        /** A observação da revisão. Nula na página pública — projeção mínima. */
        observacao?: string | null
    }
    negocio?: {
        title?: string | null
        value?: number | null
        stageName?: string | null
        createdAt?: Date | null
    } | null
    responsavel?: {
        name?: string | null
        email?: string | null
        phone?: string | null
    } | null
    /** Quem executa, quando o negócio tem um — o `profissional` da v1. */
    profissional?: string | null
}

const dataPtBr = (d: Date | null | undefined) => (d ? d.toLocaleDateString('pt-BR') : null)

const ehZero = (v: Dinheiro) => Number(v.toString()) === 0

/** O contexto, por grupo, a partir das entidades. */
export function contextoDeVariaveis(e: EntradaDoContexto): ContextoDeVariaveis {
    const tipo = ehTipoDeDocumento(e.documento.kind) ? e.documento.kind : 'proposta'
    const nome = e.contato?.name?.trim() || null
    const personalizados = variaveisPersonalizadas(e.contato?.customFields)

    return {
        cliente: {
            nome,
            primeiro_nome: nome ? nome.split(/\s+/)[0] : null,
            telefone: e.contato?.phone ?? null,
            email: e.contato?.email ?? null,
            ...personalizados.valores,
        },
        organizacao: {
            nome: e.organizacao.name,
            cnpj: e.organizacao.cnpj ?? null,
            endereco: e.organizacao.address ?? null,
            telefone: e.organizacao.phone ?? null,
        },
        documento: {
            numero: `${ROTULO_DO_TIPO[tipo]} ${e.documento.number}`,
            titulo: e.documento.title,
            tipo: ROTULO_DO_TIPO[tipo],
            data: dataPtBr(e.documento.createdAt),
            // A frase inteira, como a v1 fazia: "Válida até 22/12/2026". Vazio
            // sem prazo, e aí a pontuação órfã vai junto.
            validade: e.documento.validUntil ? `Válida até ${dataPtBr(e.documento.validUntil)}` : null,
            total: dinheiroEmTexto(e.documento.total, e.documento.moeda),
            subtotal: dinheiroEmTexto(e.documento.subtotal, e.documento.moeda),
            // Desconto zero sai vazio: o marcador desaparece em vez de imprimir
            // "Desconto: R$ 0,00".
            desconto: ehZero(e.documento.discount) ? null : dinheiroEmTexto(e.documento.discount, e.documento.moeda),
            observacao: e.documento.observacao ?? null,
        },
        negocio: {
            titulo: e.negocio?.title ?? null,
            valor:
                e.negocio?.value !== null && e.negocio?.value !== undefined
                    ? dinheiroEmTexto(e.negocio.value, e.documento.moeda)
                    : null,
            etapa: e.negocio?.stageName ?? null,
            criado_em: dataPtBr(e.negocio?.createdAt),
        },
        responsavel: {
            nome: e.responsavel?.name ?? null,
            email: e.responsavel?.email ?? null,
            telefone: e.responsavel?.phone ?? null,
            profissional: e.profissional ?? null,
        },
    }
}

/** O mapa plano que a revisão guarda em `variableValues`. */
export function congelarVariaveis(ctx: ContextoDeVariaveis): Record<string, string | null> {
    const plano = achatarVariaveis(ctx)
    const saida: Record<string, string | null> = {}
    // Só as chaves em grupo: os apelidos se reconstroem sozinhos ao achatar
    // de novo, e gravá-los dobraria o JSON sem informação nova.
    for (const [k, v] of Object.entries(plano)) if (k.includes('.')) saida[k] = v ?? null
    return saida
}

/**
 * O contexto de volta, a partir do mapa congelado.
 *
 * Chave fora dos cinco grupos é ignorada — JSON vindo do banco é dado, e dado
 * antigo pode ter forma que o código de hoje não conhece.
 */
export function contextoDeMapa(plano: unknown): ContextoDeVariaveis {
    const ctx: ContextoDeVariaveis = {}
    if (!plano || typeof plano !== 'object' || Array.isArray(plano)) return ctx
    for (const [chave, valor] of Object.entries(plano as Record<string, unknown>)) {
        const ponto = chave.indexOf('.')
        if (ponto < 0) continue
        const grupo = chave.slice(0, ponto) as Grupo
        if (!GRUPOS.includes(grupo)) continue
        const campo = chave.slice(ponto + 1)
        if (!campo) continue
        ;(ctx[grupo] ??= {})[campo] = typeof valor === 'string' ? valor : null
    }
    return ctx
}
