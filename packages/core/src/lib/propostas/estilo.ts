import { tintaSobre } from '../palette'

/**
 * O CSS do documento — um só, para a prévia do editor e para a página pública.
 *
 * ## Por que uma função que recebe o seletor
 *
 * O mesmo HTML (`renderDocumento`) aparece em dois lugares: dentro do editor,
 * em `.documento-previa`, e na página do cliente, em `.documento-publico`. Se
 * cada um tivesse o seu CSS, o vendedor veria uma coisa no Visualizar e o
 * cliente outra — e é exatamente a divergência que a v2 existe para fechar.
 * Uma string, escopada pelo seletor que o chamador passa.
 *
 * ## Só tokens de tema, nenhuma cor literal
 *
 * `hsl(var(--foreground))` e companhia: a página pública e o editor rodam nos
 * dois modos, e `lint-colors` varre este arquivo como qualquer outro.
 *
 * ## Impressão
 *
 * É o que o botão "Baixar PDF" da página pública usa. Seção de **página**
 * (`doc-pagina`) começa em folha nova; linha de item e cartão não se partem;
 * o cabeçalho da tabela repete. Sem cor de fundo na impressão, de propósito —
 * o navegador não imprime fundo por omissão, e declarar branco seria cor
 * literal sem efeito.
 *
 * Sem crase dentro da string, de propósito: ela vive num template literal, e
 * uma crase o fecharia (foi assim que o typecheck despencou em treze erros na
 * página pública, em 21/11).
 */
const COR_HEX = /^#[0-9a-fA-F]{6}$/

/**
 * A identidade do modelo entra por TRÊS variáveis — a cor, a cor suave (fundo
 * da capa) e a cor leve (fundo do preço) — e por nada mais. Sem cor do modelo,
 * as três caem no `--primary` do tema, que é o comportamento de antes.
 *
 * A cor vem de dado (`proposal_templates.theme.cor`), validada aqui de novo
 * por forma: o que não for `#rrggbb` é ignorado, para nenhum valor gravado
 * virar CSS arbitrário. `color-mix` em vez de uma segunda cor literal: a
 * transparência é calculada pelo navegador a partir da mesma cor.
 */
function variaveisDaCor(seletores: string, cor: string | null | undefined): string {
    if (!cor || !COR_HEX.test(cor)) {
        return `${seletores} { --doc-cor: hsl(var(--primary)); --doc-cor-texto: hsl(var(--primary-foreground)); --doc-cor-suave: hsl(var(--primary) / 0.08); --doc-cor-leve: hsl(var(--primary) / 0.05); }`
    }
    return `${seletores} { --doc-cor: ${cor}; --doc-cor-texto: ${tintaSobre(cor)}; --doc-cor-suave: color-mix(in srgb, ${cor} 10%, transparent); --doc-cor-leve: color-mix(in srgb, ${cor} 6%, transparent); }`
}

/**
 * @param cor A cor principal do modelo (`#rrggbb`), ou nada para o tema.
 */
export function cssDoDocumento(seletor: string, cor?: string | null): string {
    const s = seletor
    return `
${variaveisDaCor(`${s}, ${s}-moldura`, cor)}
${s}-moldura { border-top: 4px solid var(--doc-cor); }
${s} { color: hsl(var(--foreground)); font-size: 0.9375rem; line-height: 1.65; }
${s} h1 { font-size: 1.75rem; font-weight: 700; line-height: 1.2; margin: 0 0 0.5rem; }
${s} h2 { font-size: 1.125rem; font-weight: 600; margin: 1.75rem 0 0.5rem; }
${s} h3 { font-size: 0.9375rem; font-weight: 600; margin: 0 0 0.25rem; }
${s} .doc-secao:first-child h2, ${s} .doc-pagina:first-child h2 { margin-top: 0; }
${s} p { margin: 0.75rem 0; }
${s} ul { margin: 0.75rem 0; padding-left: 1.25rem; list-style: disc; }
${s} li { margin: 0.25rem 0; }
${s} .doc-vazio { color: hsl(var(--muted-foreground)); }

/* página inteira: a capa, o sumário, a carta, o fechamento */
${s} .doc-pagina { padding: 2.5rem 0; }
${s} .doc-pagina + .doc-pagina, ${s} .doc-secao + .doc-pagina { border-top: 1px solid hsl(var(--border)); }
${s} .doc-pagina-capa { position: relative; min-height: 22rem; display: flex; align-items: flex-end; padding: 2.5rem; border-radius: 0.625rem; overflow: hidden; background: var(--doc-cor-suave); }
${s} .doc-capa-arte { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
${s} .doc-capa-texto { position: relative; max-width: 32rem; }
${s} .doc-capa-organizacao { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: hsl(var(--muted-foreground)); margin: 0 0 0.75rem; }
${s} .doc-capa-titulo { font-size: 2rem; margin: 0 0 0.5rem; }
${s} .doc-capa-subtitulo { font-size: 1.0625rem; color: hsl(var(--muted-foreground)); margin: 0 0 1.25rem; }
${s} .doc-capa-rodape { display: flex; gap: 1.25rem; flex-wrap: wrap; font-size: 0.8125rem; color: hsl(var(--muted-foreground)); margin: 0; }
${s} .doc-sumario { margin: 0.75rem 0; padding-left: 1.5rem; list-style: decimal; }
${s} .doc-sumario li { padding: 0.25rem 0; border-bottom: 1px dotted hsl(var(--border)); }

/* destaques: os três números */
${s} .doc-destaques { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.75rem; padding: 0; margin: 1rem 0; list-style: none; }
${s} .doc-destaques li { display: flex; flex-direction: column; gap: 0.125rem; padding: 1rem; border: 1px solid hsl(var(--border)); border-radius: 0.625rem; margin: 0; }
${s} .doc-destaque-valor { font-size: 1.75rem; font-weight: 700; line-height: 1.1; color: var(--doc-cor); font-variant-numeric: tabular-nums; }
${s} .doc-destaque-rotulo { font-weight: 600; font-size: 0.875rem; }
${s} .doc-destaque-legenda { font-size: 0.8125rem; color: hsl(var(--muted-foreground)); }

/* escopo e garantia: cartões */
${s} .doc-cartoes, ${s} .doc-garantias { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.75rem; padding: 0; margin: 1rem 0; list-style: none; }
${s} .doc-cartoes li, ${s} .doc-garantias li { padding: 1rem; border: 1px solid hsl(var(--border)); border-radius: 0.625rem; margin: 0; }
${s} .doc-cartoes li p, ${s} .doc-garantias li p { margin: 0.25rem 0 0; font-size: 0.875rem; color: hsl(var(--muted-foreground)); }

/* fases: a linha do tempo */
${s} .doc-fases { list-style: none; padding: 0; margin: 1rem 0; counter-reset: fase; }
${s} .doc-fases li { position: relative; padding: 0 0 1.25rem 2.25rem; margin: 0; counter-increment: fase; }
${s} .doc-fases li::before { content: counter(fase); position: absolute; left: 0; top: 0; width: 1.5rem; height: 1.5rem; border-radius: 9999px; background: var(--doc-cor); color: var(--doc-cor-texto); font-size: 0.75rem; font-weight: 700; display: grid; place-items: center; }
${s} .doc-fases li:not(:last-child)::after { content: ""; position: absolute; left: 0.6875rem; top: 1.75rem; bottom: 0; width: 2px; background: hsl(var(--border)); }
${s} .doc-fase-prazo { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: hsl(var(--muted-foreground)); margin: 0 0 0.25rem; }
${s} .doc-fase-resp { font-size: 0.8125rem; color: hsl(var(--muted-foreground)); margin: 0.25rem 0 0; }

/* investimento: os cartões de preço */
${s} .doc-precos { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0.75rem; padding: 0; margin: 1rem 0; list-style: none; }
${s} .doc-precos li { padding: 1.25rem; border: 1px solid hsl(var(--border)); border-radius: 0.625rem; margin: 0; background: var(--doc-cor-leve); }
${s} .doc-preco-valor { font-size: 1.75rem; font-weight: 700; line-height: 1.1; margin: 0.25rem 0 0; font-variant-numeric: tabular-nums; }
${s} .doc-preco-periodo { font-size: 0.8125rem; color: hsl(var(--muted-foreground)); margin: 0 0 0.5rem; }
${s} .doc-precos li ul { margin: 0.5rem 0 0; padding-left: 1.1rem; font-size: 0.875rem; }

/* aceite e fechamento */
${s} .doc-aceite { margin: 1.5rem 0 0; padding: 1rem 1.25rem; border: 1px solid hsl(var(--border)); border-radius: 0.625rem; }
${s} .doc-aceite-resp { font-size: 0.8125rem; color: hsl(var(--muted-foreground)); margin: 1.5rem 0 0; padding-top: 0.5rem; border-top: 1px solid hsl(var(--foreground)); }
${s} .doc-chamada { font-size: 2rem; font-weight: 700; color: var(--doc-cor); letter-spacing: -0.01em; margin: 1.5rem 0 0.5rem; }
${s} .doc-contato { color: hsl(var(--muted-foreground)); font-size: 0.875rem; }

/* a tabela de itens */
${s} .doc-itens { width: 100%; margin: 1.5rem 0; border-collapse: collapse; font-size: 0.875rem; }
${s} .doc-itens th, ${s} .doc-itens td { padding: 0.625rem 0.5rem; border-bottom: 1px solid hsl(var(--border)); text-align: left; vertical-align: top; }
${s} .doc-itens th { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: hsl(var(--muted-foreground)); }
${s} .doc-col-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
${s} .doc-itens tfoot td { border-bottom: 0; padding-top: 0.75rem; }
${s} .doc-subtotal td { color: hsl(var(--muted-foreground)); padding-top: 0.375rem; padding-bottom: 0.375rem; }
${s} .doc-total td { font-weight: 600; font-size: 1rem; border-top: 1px solid hsl(var(--border)); }

@media print {
    ${s} { font-size: 11pt; }
    ${s} .doc-pagina { break-before: page; padding: 0; border-top: 0; }
    ${s} .doc-pagina:first-child { break-before: auto; }
    ${s} .doc-pagina-capa { min-height: 60vh; }
    ${s} .doc-secao, ${s} .doc-destaques li, ${s} .doc-cartoes li, ${s} .doc-precos li, ${s} .doc-fases li { break-inside: avoid; }
    ${s} .doc-itens { font-size: 10pt; }
    ${s} .doc-itens tr { break-inside: avoid; }
    ${s} .doc-itens thead { display: table-header-group; }
}
`
}
