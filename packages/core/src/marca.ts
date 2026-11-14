/**
 * De onde o código compartilhado lê a marca — no servidor, na fila e no cron.
 *
 * ## Por que não é um import
 *
 * O core não pode importar `apps/<app>/src/config/brand.ts`: seria
 * `core → app`, e é a dependência que o monorepo existe para não ter. Então o
 * app **registra** a sua marca no arranque e o core a **pede**.
 *
 * Medido antes de escrever isto: 10 dos arquivos que vêm para o core importam
 * hoje `@/config/brand`, e 5 deles são de servidor — `lib/email/templates.ts`,
 * `layout.ts`, `billing.ts`, `lib/funil/acoes.ts` e
 * `trabalhos/servicos/broadcast.ts`. Repare no que eles têm em comum: **quatro
 * rodam fora de request**, em fila e cron. Não existe provider de React acima
 * deles, e é por isso que a via do servidor é um registro de módulo e não um
 * contexto — e também por que o vocabulário do nicho tem de viver na marca
 * estática do app, e não só numa configuração lida do banco por requisição.
 *
 * Os 5 restantes são componentes `'use client'` e usam a outra via,
 * `./marca-contexto`.
 *
 * ## Por que falha alto
 *
 * `BRAND()` lança se ninguém registrou. A alternativa seria devolver uma marca
 * vazia ou um padrão, e as duas são piores: o app subiria mostrando nome em
 * branco, ou — muito pior num produto de três nichos — mostrando a marca
 * errada, calado. Um erro no arranque aparece no smoke de staging; uma marca
 * errada aparece ao cliente.
 *
 * Quem registra, e onde, é verificado estaticamente por
 * `scripts/check-marca.mjs`: o import do registro tem de vir antes de qualquer
 * import do core nos dois pontos de entrada (a raiz do App Router e o
 * entrypoint do Worker, que é o que cobre fila, cron e Durable Object).
 */
import type { Brand } from '@venn/config/marca'

/**
 * Uma por isolate, e isso é suficiente: cada Worker serve um produto só (o
 * `cloudflare.config.ts` é por app e a identidade dele é irrenomeável). Se um
 * dia um Worker servisse duas marcas, isto teria de virar escopo de
 * requisição — e o `audit:isolation` é quem perceberia primeiro, porque
 * passaria a haver dois `brand.ts` alcançáveis do mesmo build.
 */
let registrada: Brand | null = null

export class MarcaNaoRegistradaError extends Error {
    constructor() {
        super(
            'A marca não foi registrada. O ponto de entrada tem de chamar ' +
            '`registrarBrand(BRAND)` ANTES de qualquer código do core — veja ' +
            '`src/marca-init.ts` e `scripts/check-marca.mjs`.'
        )
        this.name = 'MarcaNaoRegistradaError'
    }
}

export function registrarBrand(marca: Brand): void {
    registrada = marca
}

/**
 * A marca do app que está rodando. Lança se ninguém registrou — ver acima por
 * que lançar é o comportamento certo aqui.
 */
export function BRAND(): Brand {
    if (!registrada) throw new MarcaNaoRegistradaError()
    return registrada
}

/** Para os verificadores: devolve ao estado inicial. Não use em produção. */
export function _limparBrandParaTeste(): void {
    registrada = null
}
