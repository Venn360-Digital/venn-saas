import type { PaginaDeIndice } from '@venn/core/lib/indice'

/**
 * O contrato entre a casca de servidor e o componente de cliente.
 *
 * Mora **fora** do arquivo `'use client'` de propósito, e isso não é
 * organização: um componente de servidor **não consegue importar valor** de um
 * módulo de cliente. O Next troca cada export daquele módulo por uma referência
 * de cliente, então uma constante chega do outro lado como função — e o erro sai
 * longe do causador (`Invalid value for argument 'take': [object Function]`).
 * A explicação longa está em `vendas/servicos/dados.ts`.
 */
export { LIMITE_PADRAO } from '@venn/core/lib/indice'

/** O "sem filtro" acordado com o `GET /api/propostas`. */
export const TIPO_PADRAO = 'all'
export const STATUS_PADRAO = 'all'

export interface PropostaItem {
    id: string
    kind: string
    title: string
    number: number
    currency: string
    /**
     * Datas em texto, não `Date`.
     *
     * Quem repinta a lista é a rota de API, e lá o JSON já achata a data em
     * string ISO. O servidor se dobra ao formato do cliente; o contrário
     * obrigaria o estado a aceitar dois tipos para o mesmo campo.
     */
    createdAt: string
    deal: { id: string; title: string } | null
    createdBy: { id: string; name: string | null } | null
    /**
     * A revisão vigente, achatada.
     *
     * `total` é **string**, e não número: a coluna é `Decimal(18,4)` e
     * atravessar para o cliente como `number` reintroduziria o `Float` que este
     * módulo existe para evitar. A tela formata a string.
     */
    currentRevision: {
        version: number
        status: string
        total: string
        validUntil: string | null
        /** O último link não revogado, quando há. */
        ultimoLink: {
            acceptedAt: string | null
            expiresAt: string
            aberturas: number
        } | null
    } | null
}

/** O que o servidor entregou, pronto para a primeira pintura. */
export type DadosIniciais = PaginaDeIndice<PropostaItem>
