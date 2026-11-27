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

// ── o que a IA e o importador devolvem, e como vira seção ────────────────

/**
 * A forma PLANA que o modelo preenche.
 *
 * Saída estruturada com `strict: true` exige todo campo presente e nenhum a
 * mais — um schema com treze variantes de objeto seria enorme e frágil. Então o
 * modelo devolve uma linha genérica por entrada (`a`, `b`, `c`, `d`) e o
 * mapeamento por tipo mora aqui, em código que o verificador prova:
 *
 * | tipo         | a        | b          | c           | d          |
 * |--------------|----------|------------|-------------|------------|
 * | destaques    | valor    | rótulo     | legenda     | —          |
 * | escopo       | título   | descrição  | —           | —          |
 * | fases        | nome     | prazo      | responsável | descrição  |
 * | investimento | título   | valor      | período     | inclui (;) |
 * | garantia     | título   | texto      | —           | —          |
 */
export interface SecaoPlana {
    tipo: string
    titulo: string | null
    corpo: string | null
    linhas: { a: string; b: string; c: string | null; d: string | null }[]
}

/** O JSON Schema de `SecaoPlana[]`, para `generateEstruturado` (strict). */
export const SCHEMA_DAS_SECOES_PLANAS = {
    type: 'object',
    properties: {
        secoes: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    tipo: { type: 'string', enum: [...TIPOS_DE_SECAO] },
                    titulo: { type: ['string', 'null'] },
                    corpo: { type: ['string', 'null'], description: 'Texto da seção. Linha com "# " é título; com "- " é item de lista.' },
                    linhas: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                a: { type: 'string' },
                                b: { type: 'string' },
                                c: { type: ['string', 'null'] },
                                d: { type: ['string', 'null'] },
                            },
                            required: ['a', 'b', 'c', 'd'],
                            additionalProperties: false,
                        },
                    },
                },
                required: ['tipo', 'titulo', 'corpo', 'linhas'],
                additionalProperties: false,
            },
        },
    },
    required: ['secoes'],
    additionalProperties: false,
} as const

/** Linha plana → seção tipada. Tipo desconhecido é descartado, não inventado. */
export function secoesDaResposta(planas: readonly SecaoPlana[]): Secao[] {
    const saida: Secao[] = []
    planas.forEach((p, i) => {
        if (!ehTipoDeSecao(p.tipo)) return
        const id = `s${i + 1}`
        const titulo = p.titulo?.trim() || null
        const corpo = p.corpo?.trim() ?? ''
        switch (p.tipo) {
            case 'capa':
                saida.push({ id, tipo: 'capa', titulo, subtitulo: corpo || null })
                break
            case 'sumario':
                saida.push({ id, tipo: 'sumario' })
                break
            case 'carta':
            case 'texto':
            case 'condicoes':
                saida.push({ id, tipo: p.tipo, titulo, corpo })
                break
            case 'destaques':
                saida.push({ id, tipo: 'destaques', titulo, itens: p.linhas.map((l) => ({ valor: l.a, rotulo: l.b, legenda: l.c })) })
                break
            case 'escopo':
                saida.push({ id, tipo: 'escopo', titulo, cartoes: p.linhas.map((l) => ({ titulo: l.a, descricao: l.b })) })
                break
            case 'fases':
                saida.push({ id, tipo: 'fases', titulo, fases: p.linhas.map((l) => ({ nome: l.a, prazo: l.b || null, responsavel: l.c, descricao: l.d ?? '' })) })
                break
            case 'itens':
                saida.push({ id, tipo: 'itens', titulo })
                break
            case 'investimento':
                saida.push({
                    id, tipo: 'investimento', titulo, introducao: corpo || null,
                    cartoes: p.linhas.map((l) => ({ titulo: l.a, valor: l.b, periodo: l.c, inclui: (l.d ?? '').split(';').map((x) => x.trim()).filter(Boolean) })),
                })
                break
            case 'garantia':
                saida.push({ id, tipo: 'garantia', titulo, blocos: p.linhas.map((l) => ({ titulo: l.a, texto: l.b })) })
                break
            case 'aceite':
                saida.push({ id, tipo: 'aceite', texto: corpo || null })
                break
            case 'fechamento':
                saida.push({ id, tipo: 'fechamento', titulo, corpo, chamada: p.linhas[0]?.a || null })
                break
        }
    })
    return saida
}

/**
 * Esvazia o que é compromisso — a regra "a IA não promete", aplicada em código.
 *
 * O prompt pede; isto garante. Número de resultado, prazo, preço e texto de
 * garantia ficam em branco; títulos e rótulos ficam, porque são a moldura que
 * a pessoa preenche. Condições inteira em branco — cláusula é de quem assina.
 */
export function esvaziarCompromissos(secoes: readonly Secao[]): Secao[] {
    return secoes.map((s) => {
        switch (s.tipo) {
            case 'destaques':
                return { ...s, itens: s.itens.map((d) => ({ ...d, valor: '' })) }
            case 'fases':
                return { ...s, fases: s.fases.map((f) => ({ ...f, prazo: null })) }
            case 'investimento':
                return { ...s, cartoes: s.cartoes.map((c) => ({ ...c, valor: '' })) }
            case 'garantia':
                return { ...s, blocos: s.blocos.map((b) => ({ ...b, texto: '' })) }
            case 'condicoes':
                return { ...s, corpo: '' }
            default:
                return s
        }
    })
}

/**
 * As trocas que o importador sugere: um trecho literal do documento que parece
 * um dado do sistema. A pessoa confirma uma a uma; nada é trocado sem ela.
 */
export interface SugestaoDeVariavel {
    literal: string
    chave: string
}

/** As chaves que o importador pode sugerir — o que se reconhece num texto. */
export const CHAVES_SUGERIVEIS = [
    'cliente.nome',
    'organizacao.nome',
    'organizacao.cnpj',
    'documento.data',
    'documento.total',
    'responsavel.nome',
] as const

/** Aplica as sugestões aceitas: troca cada literal pelo token, em todas as seções. */
export function aplicarSugestoes(secoes: readonly Secao[], aceitas: readonly SugestaoDeVariavel[]): Secao[] {
    const validas = aceitas.filter((a) => a.literal.trim().length >= 3 && (CHAVES_SUGERIVEIS as readonly string[]).includes(a.chave))
    if (validas.length === 0) return [...secoes]
    const trocar = (t: string) => validas.reduce((acc, a) => acc.split(a.literal).join(`{{${a.chave}}}`), t)
    const trocarOpc = (t: string | null | undefined) => (t ? trocar(t) : t)
    return secoes.map((s) => {
        switch (s.tipo) {
            case 'capa':
                return { ...s, titulo: trocarOpc(s.titulo), subtitulo: trocarOpc(s.subtitulo) }
            case 'carta':
            case 'texto':
            case 'condicoes':
                return { ...s, titulo: trocarOpc(s.titulo), corpo: trocar(s.corpo) }
            case 'destaques':
                return { ...s, titulo: trocarOpc(s.titulo), itens: s.itens.map((d) => ({ ...d, valor: trocar(d.valor), rotulo: trocar(d.rotulo), legenda: trocarOpc(d.legenda) })) }
            case 'escopo':
                return { ...s, titulo: trocarOpc(s.titulo), cartoes: s.cartoes.map((c) => ({ ...c, titulo: trocar(c.titulo), descricao: trocar(c.descricao) })) }
            case 'fases':
                return { ...s, titulo: trocarOpc(s.titulo), fases: s.fases.map((f) => ({ ...f, nome: trocar(f.nome), descricao: trocar(f.descricao), responsavel: trocarOpc(f.responsavel), prazo: trocarOpc(f.prazo) })) }
            case 'investimento':
                return { ...s, titulo: trocarOpc(s.titulo), introducao: trocarOpc(s.introducao), cartoes: s.cartoes.map((c) => ({ ...c, titulo: trocar(c.titulo), valor: trocar(c.valor), periodo: trocarOpc(c.periodo), inclui: c.inclui.map(trocar) })) }
            case 'garantia':
                return { ...s, titulo: trocarOpc(s.titulo), blocos: s.blocos.map((b) => ({ ...b, titulo: trocar(b.titulo), texto: trocar(b.texto) })) }
            case 'aceite':
                return { ...s, texto: trocarOpc(s.texto) }
            case 'fechamento':
                return { ...s, titulo: trocarOpc(s.titulo), corpo: trocar(s.corpo), chamada: trocarOpc(s.chamada) }
            default:
                return s
        }
    })
}
