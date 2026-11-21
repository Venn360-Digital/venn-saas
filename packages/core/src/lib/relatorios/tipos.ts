/**
 * Quais relatórios existem — num módulo neutro, fora de `rotas/`.
 *
 * ## Por que não mora no `page.tsx`
 *
 * Porque `scripts/gerar-rotas.ts` recusa, e tem razão: o app importa o
 * **wrapper**, que reexporta só o `default`. Um tipo exportado de dentro de
 * `rotas/` ficaria inalcançável para quem o importasse pelo alias do app — e o
 * erro apareceria longe da causa.
 *
 *     ✖ "(dashboard)/relatorios/page.tsx" exporta o tipo `TipoDeRelatorio`.
 *       O app importa o wrapper, não o fonte — o tipo ficaria inalcançável.
 *
 * Então o domínio mora aqui e as três superfícies o importam: a tela, a rota de
 * JSON e a de CSV. É também o que garante que as três concordem sobre o que é
 * um tipo válido — a lista num lugar só.
 */

export const TIPOS_DE_RELATORIO = ['propostas', 'produtos', 'funil'] as const

export type TipoDeRelatorio = (typeof TIPOS_DE_RELATORIO)[number]

export function ehTipoDeRelatorio(valor: string | undefined | null): valor is TipoDeRelatorio {
    return (TIPOS_DE_RELATORIO as readonly string[]).includes(valor ?? '')
}

/** O rótulo de cada um. Nenhum deles é palavra de nicho. */
export const ROTULO_DO_RELATORIO: Record<TipoDeRelatorio, string> = {
    propostas: 'Propostas',
    produtos: 'Produtos',
    funil: 'Funil',
}
