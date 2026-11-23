import { z } from 'zod'

import { MARCADOR_DE_ITENS } from './variaveis'

/**
 * As seções de um documento — o que a v2 põe no lugar do corpo de texto.
 *
 * ## Por que seções tipadas, e não texto nem HTML
 *
 * Decisão do André em 22/11/2026, depois de ver a própria proposta comercial:
 * uma proposta é uma **publicação** — capa, carta, destaques, escopo, fases,
 * investimento, fechamento —, não um texto com uma tabela no meio. Cada uma
 * dessas partes tem layout próprio, e layout é do produto, não de quem escreve.
 * Seção tipada é o que permite isso: a organização preenche campos, o render
 * decide a forma, e o resultado sai igual no editor, no link e na impressão.
 *
 * Editor livre (HTML) foi recusado por desenho: não há sanitizador neste
 * projeto, e HTML que o render tivesse de confiar seria a porta para o que
 * `render.ts` escapa hoje. É também o que torna possível a IA **gerar** e o
 * importador **reconhecer** um modelo — os dois produzem seções, nunca HTML.
 *
 * ## Módulo neutro, de propósito
 *
 * Sem `server-only` e sem Prisma: o editor no navegador precisa dos tipos, dos
 * rótulos e do `ehPagina`, e o servidor precisa do schema para validar o que
 * chega. A regra 7 de `check-marca.mjs` reprovaria qualquer coisa a mais aqui.
 *
 * ## O texto dentro de uma seção
 *
 * Continua sendo a convenção de linha de `render.ts` (`# ` título, `- ` lista,
 * o resto parágrafo), com os marcadores `{{grupo.campo}}` de `variaveis.ts`.
 * Nada muda na gramática — muda só onde o texto mora.
 */

/**
 * Os tipos, na ordem em que costumam aparecer numa proposta.
 *
 * `texto` é o genérico — e é no que o corpo da v1 vira ao ser convertido.
 * Domínio fechado em `String` com o conjunto aqui, nunca enum do Prisma.
 */
export const TIPOS_DE_SECAO = [
    'capa',
    'sumario',
    'carta',
    'texto',
    'destaques',
    'escopo',
    'fases',
    'itens',
    'investimento',
    'garantia',
    'condicoes',
    'aceite',
    'fechamento',
] as const

export type TipoDeSecao = (typeof TIPOS_DE_SECAO)[number]

export function ehTipoDeSecao(valor: string): valor is TipoDeSecao {
    return (TIPOS_DE_SECAO as readonly string[]).includes(valor)
}

/** Rótulo para a tela — o nome que a pessoa escolhe na biblioteca. */
export const ROTULO_DA_SECAO: Record<TipoDeSecao, string> = {
    capa: 'Capa',
    sumario: 'Sumário',
    carta: 'Carta de apresentação',
    texto: 'Texto',
    destaques: 'Destaques',
    escopo: 'Escopo',
    fases: 'Fases',
    itens: 'Itens e valores',
    investimento: 'Investimento',
    garantia: 'Garantia e bônus',
    condicoes: 'Condições',
    aceite: 'Aceite',
    fechamento: 'Fechamento',
}

/**
 * Seção de **página** ocupa uma folha inteira; a de bloco corre com o texto.
 *
 * É o que decide a quebra de página na impressão e a miniatura no trilho do
 * editor. Quatro páginas, tiradas da proposta de referência: capa, sumário,
 * carta, fechamento.
 */
const PAGINAS: ReadonlySet<TipoDeSecao> = new Set(['capa', 'sumario', 'carta', 'fechamento'])

export function ehPagina(tipo: TipoDeSecao): boolean {
    return PAGINAS.has(tipo)
}

/**
 * O que é **compromisso** — e por isso a IA deixa em branco.
 *
 * Número de resultado, prazo, preço, garantia e multa são promessas no nome da
 * organização. A IA escreve apresentação; compromisso é de quem assina. A
 * lista está aqui, e não no prompt, para que a tela possa marcar a seção como
 * "falta preencher" e o verificador possa cobrar que a IA respeitou.
 */
const COMPROMISSO: ReadonlySet<TipoDeSecao> = new Set(['destaques', 'fases', 'investimento', 'garantia', 'condicoes'])

export function ehCompromisso(tipo: TipoDeSecao): boolean {
    return COMPROMISSO.has(tipo)
}

// ── a forma de cada uma ──────────────────────────────────────────────────

/** O que toda seção tem. `fixa` vem do modelo: não se apaga no documento. */
const base = {
    id: z.string().min(1).max(40),
    fixa: z.boolean().optional(),
}

const texto = z.string().max(20_000)
const curto = z.string().max(200)

export const secaoSchema = z.discriminatedUnion('tipo', [
    z.object({
        ...base,
        tipo: z.literal('capa'),
        titulo: curto.nullable().optional(),
        subtitulo: curto.nullable().optional(),
        /** A arte, no bucket público. Nula = capa só com cor do tema. */
        imageKey: z.string().max(300).nullable().optional(),
    }),
    z.object({ ...base, tipo: z.literal('sumario') }),
    z.object({ ...base, tipo: z.literal('carta'), titulo: curto.nullable().optional(), corpo: texto }),
    z.object({ ...base, tipo: z.literal('texto'), titulo: curto.nullable().optional(), corpo: texto }),
    z.object({
        ...base,
        tipo: z.literal('destaques'),
        titulo: curto.nullable().optional(),
        itens: z
            .array(z.object({ valor: curto, rotulo: curto, legenda: curto.nullable().optional() }))
            .max(6),
    }),
    z.object({
        ...base,
        tipo: z.literal('escopo'),
        titulo: curto.nullable().optional(),
        cartoes: z.array(z.object({ titulo: curto, descricao: texto })).max(12),
    }),
    z.object({
        ...base,
        tipo: z.literal('fases'),
        titulo: curto.nullable().optional(),
        fases: z
            .array(
                z.object({
                    nome: curto,
                    descricao: texto,
                    responsavel: curto.nullable().optional(),
                    prazo: curto.nullable().optional(),
                })
            )
            .max(12),
    }),
    z.object({ ...base, tipo: z.literal('itens'), titulo: curto.nullable().optional() }),
    z.object({
        ...base,
        tipo: z.literal('investimento'),
        titulo: curto.nullable().optional(),
        introducao: texto.nullable().optional(),
        cartoes: z
            .array(
                z.object({
                    titulo: curto,
                    valor: curto,
                    periodo: curto.nullable().optional(),
                    inclui: z.array(curto).max(12),
                })
            )
            .max(4),
    }),
    z.object({
        ...base,
        tipo: z.literal('garantia'),
        titulo: curto.nullable().optional(),
        blocos: z.array(z.object({ titulo: curto, texto })).max(8),
    }),
    z.object({ ...base, tipo: z.literal('condicoes'), titulo: curto.nullable().optional(), corpo: texto }),
    z.object({ ...base, tipo: z.literal('aceite'), texto: texto.nullable().optional() }),
    z.object({
        ...base,
        tipo: z.literal('fechamento'),
        titulo: curto.nullable().optional(),
        corpo: texto,
        /** "Obrigado." — a palavra grande da última página. */
        chamada: curto.nullable().optional(),
    }),
])

export type Secao = z.infer<typeof secaoSchema>

/** A lista inteira, com o teto que cabe num documento. */
export const secoesSchema = z.array(secaoSchema).max(40)

// ── a conversão do corpo da v1 ───────────────────────────────────────────

/**
 * O corpo de texto da v1 → seções, sem perder nada.
 *
 * O corpo era texto com marcadores e um `{{itens}}` no meio. Vira: um `texto`
 * com o que havia antes da tabela, um `itens`, um `texto` com o que havia
 * depois. Sem `{{itens}}`, é um `texto` só.
 *
 * Determinística e sem id aleatório: o id é posicional, para que converter
 * duas vezes dê o mesmo resultado — é o que permite ao verificador comparar o
 * render do corpo com o render das seções byte a byte.
 */
export function converterCorpoEmSecoes(corpo: string | null | undefined): Secao[] {
    const bruto = (corpo ?? '').trim()
    if (!bruto) return []

    const marcador = new RegExp(`\\{\\{\\s*${MARCADOR_DE_ITENS}\\s*(?:\\|[^}]*)?\\}\\}`, 'g')
    const partes = bruto.split(marcador)

    const secoes: Secao[] = []
    partes.forEach((parte, i) => {
        const trecho = parte.trim()
        if (trecho) secoes.push({ id: `s${secoes.length + 1}`, tipo: 'texto', corpo: trecho })
        // Entre uma parte e a próxima havia um `{{itens}}`.
        if (i < partes.length - 1) secoes.push({ id: `s${secoes.length + 1}`, tipo: 'itens' })
    })
    return secoes
}

/**
 * As seções de um documento sem modelo — o que a v1 chamava de corpo padrão.
 *
 * Nenhuma palavra de nicho: o que varia vem pelos marcadores.
 */
export function secoesPadrao(): Secao[] {
    return [
        { id: 's1', tipo: 'texto', corpo: '# {{documento.titulo}}\n\nPara: {{cliente.nome}}\n\nEmitido em {{documento.data}}' },
        { id: 's2', tipo: 'itens' },
        { id: 's3', tipo: 'texto', corpo: '{{documento.observacao}}' },
    ]
}

/** Os textos livres de uma lista de seções — é onde moram os marcadores. */
export function textosDasSecoes(secoes: readonly Secao[]): string[] {
    const saida: string[] = []
    for (const s of secoes) {
        switch (s.tipo) {
            case 'capa':
                if (s.titulo) saida.push(s.titulo)
                if (s.subtitulo) saida.push(s.subtitulo)
                break
            case 'carta':
            case 'texto':
            case 'condicoes':
                if (s.titulo) saida.push(s.titulo)
                saida.push(s.corpo)
                break
            case 'destaques':
                if (s.titulo) saida.push(s.titulo)
                for (const d of s.itens) saida.push(d.valor, d.rotulo, d.legenda ?? '')
                break
            case 'escopo':
                if (s.titulo) saida.push(s.titulo)
                for (const c of s.cartoes) saida.push(c.titulo, c.descricao)
                break
            case 'fases':
                if (s.titulo) saida.push(s.titulo)
                for (const f of s.fases) saida.push(f.nome, f.descricao, f.responsavel ?? '', f.prazo ?? '')
                break
            case 'investimento':
                if (s.titulo) saida.push(s.titulo)
                if (s.introducao) saida.push(s.introducao)
                for (const c of s.cartoes) saida.push(c.titulo, c.valor, c.periodo ?? '', ...c.inclui)
                break
            case 'garantia':
                if (s.titulo) saida.push(s.titulo)
                for (const b of s.blocos) saida.push(b.titulo, b.texto)
                break
            case 'aceite':
                if (s.texto) saida.push(s.texto)
                break
            case 'fechamento':
                if (s.titulo) saida.push(s.titulo)
                saida.push(s.corpo)
                if (s.chamada) saida.push(s.chamada)
                break
            case 'itens':
            case 'sumario':
                break
        }
    }
    return saida.filter((t) => t.length > 0)
}
