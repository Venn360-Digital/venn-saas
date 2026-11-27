import { tintaSobre } from '../palette'
import { lerTema, TEMA_PADRAO, type TemaDoModelo } from './tema'

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
/**
 * As variáveis que a identidade do modelo injeta — e **nada além delas**.
 *
 * | variável | o que marca |
 * |---|---|
 * | `--doc-cor` | o acento principal: chamada, numeração, destaque |
 * | `--doc-cor-b`, `--doc-cor-c` | o segundo e o terceiro acento |
 * | `--doc-cor-texto` | a tinta que se lê **sobre** o acento principal |
 * | `--doc-cor-suave`, `--doc-cor-leve` | fundos tonais de capa e de cartão |
 * | `--doc-fonte` | a família do documento |
 *
 * Sem acento no tema, as três cores caem no `--primary` do app, que é o
 * comportamento de todo modelo anterior a 27/11/2026. Com **um** acento, as
 * três são ele: a distribuição cicla, então modelo de uma cor segue chapado de
 * propósito e modelo de três ganha ritmo.
 *
 * As cores chegam já validadas por `lerTema`, e aqui não há literal de cor
 * nenhum — `lint-colors` varre este arquivo como qualquer outro.
 */
/**
 * As regras da capa escura — emitidas **só quando o tema a pede**.
 *
 * Poderia ser um atributo no HTML (`data-capa="escura"`) e uma regra fixa, e
 * era assim que eu tinha escrito. Não pode: o tema é da conta e o HTML é o que
 * o aceite hasheia, então um atributo vindo do tema faria o hash de um
 * documento já aceito mudar quando alguém trocasse o estilo do modelo. O CSS já
 * recebe o tema e não é hasheado, então a decisão mora aqui.
 */
function capaEscura(s: string, tema: TemaDoModelo): string {
    if (tema.capa !== 'escura') return ''
    return [
        s + ' .doc-pagina-capa { --doc-capa-fundo: hsl(var(--foreground)); background: hsl(var(--foreground)); color: hsl(var(--background)); }',
        s + ' .doc-pagina-capa .doc-capa-titulo { color: hsl(var(--background)); }',
        s + ' .doc-pagina-capa .doc-capa-organizacao,',
        s + ' .doc-pagina-capa .doc-capa-subtitulo,',
        s + ' .doc-pagina-capa .doc-capa-rodape { color: hsl(var(--background) / 0.72); }',
    ].join('\n')
}

function variaveisDoTema(seletores: string, tema: TemaDoModelo): string {
    const fonte =
        tema.fonte === 'tecnica'
            ? 'var(--font-inter), var(--font-sans), ui-sans-serif, system-ui, sans-serif'
            : 'var(--font-sans), ui-sans-serif, system-ui, sans-serif'

    if (tema.acentos.length === 0) {
        return (
            seletores +
            ' { --doc-cor: hsl(var(--primary)); --doc-cor-b: hsl(var(--primary)); --doc-cor-c: hsl(var(--primary));' +
            ' --doc-cor-texto: hsl(var(--primary-foreground));' +
            ' --doc-cor-suave: hsl(var(--primary) / 0.08); --doc-cor-leve: hsl(var(--primary) / 0.05);' +
            ' --doc-fonte: ' + fonte + '; }'
        )
    }

    // Cicla: um acento serve aos três papéis; três servem a um cada.
    const a = tema.acentos
    const cor = a[0]
    const corB = a[1] ?? a[0]
    const corC = a[2] ?? a[1] ?? a[0]

    return (
        seletores +
        ' { --doc-cor: ' + cor + '; --doc-cor-b: ' + corB + '; --doc-cor-c: ' + corC + ';' +
        ' --doc-cor-texto: ' + tintaSobre(cor) + ';' +
        ' --doc-cor-suave: color-mix(in srgb, ' + cor + ' 10%, transparent);' +
        ' --doc-cor-leve: color-mix(in srgb, ' + cor + ' 6%, transparent);' +
        ' --doc-fonte: ' + fonte + '; }'
    )
}

/**
 * @param seletor O escopo: `.documento-previa` no editor, `.documento-publico`
 *   na página do cliente.
 * @param temaBruto O `theme` do modelo, como veio do banco. Aceita a forma
 *   antiga de uma cor só — ver `lerTema`.
 */
export function cssDoDocumento(seletor: string, temaBruto?: unknown): string {
    const s = seletor
    const tema = temaBruto === undefined || temaBruto === null ? TEMA_PADRAO : lerTema(temaBruto)
    return `
${variaveisDoTema(`${s}, ${s}-moldura`, tema)}
${s} { font-family: var(--doc-fonte); }
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

/* ── o véu da capa: o conserto de legibilidade ─────────────────────────────
   A arte vem de IA e pode sair escura. Sem uma camada entre ela e o texto, uma
   capa escura com tinta escura fica ilegível — e isso não depende de ninguém
   errar, depende da imagem que o modelo sortear. O véu é um degradê da cor de
   fundo da capa, forte embaixo (onde o texto mora) e transparente em cima. */
${s} .doc-capa-veu { position: absolute; inset: 0; background: linear-gradient(to top, var(--doc-capa-fundo) 12%, color-mix(in srgb, var(--doc-capa-fundo) 55%, transparent) 48%, transparent 85%); }
${s} .doc-pagina-capa { --doc-capa-fundo: hsl(var(--background)); }
${capaEscura(s, tema)}
${s} .doc-capa-marca { position: relative; display: flex; align-items: center; gap: 0.625rem; margin: 0 0 auto; }
${s} .doc-capa-marca img { max-height: 2rem; width: auto; }
${s} .doc-pagina-capa { flex-direction: column; justify-content: space-between; align-items: stretch; }

/* ── o sobretítulo numerado: "02 — ESCOPO DO PROJETO" ───────────────────── */
${s} .doc-sobretitulo { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--doc-cor); margin: 0 0 0.375rem; }

/* ── o fio divisor em degradê, entre blocos grandes ─────────────────────── */
${s} .doc-fio { height: 3px; border: 0; margin: 2rem 0 1.5rem; background: linear-gradient(to right, var(--doc-cor), var(--doc-cor-b), var(--doc-cor-c)); }

/* ── acento por posição: o que dá ritmo em vez de caixas iguais ──────────── */
${s} .doc-cartoes li:nth-child(3n+1), ${s} .doc-garantias li:nth-child(3n+1), ${s} .doc-fases > li:nth-child(3n+1) { --acento: var(--doc-cor); }
${s} .doc-cartoes li:nth-child(3n+2), ${s} .doc-garantias li:nth-child(3n+2), ${s} .doc-fases > li:nth-child(3n+2) { --acento: var(--doc-cor-b); }
${s} .doc-cartoes li:nth-child(3n+3), ${s} .doc-garantias li:nth-child(3n+3), ${s} .doc-fases > li:nth-child(3n+3) { --acento: var(--doc-cor-c); }
${s} .doc-cartoes li h3, ${s} .doc-garantias li h3 { color: var(--acento, var(--doc-cor)); }
${s} .doc-cartoes li { border-top: 3px solid var(--acento, var(--doc-cor)); }
${s} .doc-fases li::before { background: var(--acento, var(--doc-cor)); }

/* ── o cartão de preço principal, invertido ─────────────────────────────── */
${s} .doc-precos li:first-child { background: hsl(var(--foreground)); color: hsl(var(--background)); border-color: hsl(var(--foreground)); }
${s} .doc-precos li:first-child .doc-preco-periodo, ${s} .doc-precos li:first-child p { color: hsl(var(--background) / 0.78); }
${s} .doc-preco-condicao { display: inline-block; margin: 0.75rem 0 0; padding: 0.375rem 0.75rem; border-radius: 0.375rem; background: var(--doc-cor); color: var(--doc-cor-texto); font-size: 0.8125rem; font-weight: 600; }

/* ── o cabeçalho e o rodapé que se repetem na impressão ──────────────────
   Escondidos na tela, de propósito: a página pública rola, e cabeçalho fixo
   sobre conteúdo que rola atrapalha em vez de ajudar — a tela já tem o seu
   próprio cabeçalho. Na impressão eles entram pela margem da folha com
   position:fixed, que é o que o Chromium repete em toda página. SEM CRASE
   aqui dentro: ela fecharia o template literal, e foi assim que o typecheck
   despencou em 21/11. */
${s} .doc-chrome { display: none; }

@media print {
    /* A moldura da folha. A margem de cima e a de baixo são maiores porque é
       nelas que o cabeçalho e o rodapé entram. */
    @page { margin: 18mm 14mm 16mm; }
    ${s} { font-size: 11pt; }
    ${s} .doc-chrome { display: flex; position: fixed; left: 0; right: 0; align-items: center; justify-content: space-between; gap: 1rem; font-size: 8.5pt; color: hsl(var(--muted-foreground)); }
    ${s} .doc-chrome-topo { top: -11mm; padding-bottom: 2mm; border-bottom: 1px solid hsl(var(--border)); }
    ${s} .doc-chrome-rodape { bottom: -10mm; padding-top: 2mm; border-top: 1px solid hsl(var(--border)); }
    ${s} .doc-chrome-marca { display: flex; align-items: center; gap: 0.5rem; font-weight: 600; }
    ${s} .doc-chrome-marca img { max-height: 5mm; width: auto; }
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
