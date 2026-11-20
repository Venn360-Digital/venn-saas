import { z } from 'zod'

import { BRAND_HEX } from '../palette'

/**
 * O formulário de captura: a forma dos campos, da configuração e do envio.
 *
 * Um módulo **puro**, lido pelos dois lados: o editor (para desenhar e avisar
 * antes de salvar), a API (para recusar o que a tela deixou passar), a página
 * pública (para validar antes de enviar) e a rota de envio (para validar de
 * novo, porque o que chega do navegador de um desconhecido não é confiável).
 * Duas cópias da regra divergiriam na primeira borda — e aqui a borda é um
 * lead perdido ou um lixo gravado.
 *
 * ## O que um campo é
 *
 * Tipo, rótulo, obrigatório, opções (para seleção) e **para onde o valor vai
 * na ficha** (`mapeia`): nome, telefone, e-mail, observações, ou lugar nenhum.
 * O mapeamento é o que transforma respostas num contato; o resto das respostas
 * fica no envio e no resumo que vai para o negócio.
 */

export const TIPOS_DE_CAMPO = [
    'texto',
    'email',
    'telefone',
    'paragrafo',
    'numero',
    'data',
    'selecao',
    'multipla',
    'caixa',
] as const
export type TipoDeCampo = (typeof TIPOS_DE_CAMPO)[number]

export const NOME_DO_TIPO: Record<TipoDeCampo, string> = {
    texto: 'Texto curto',
    email: 'E-mail',
    telefone: 'Telefone',
    paragrafo: 'Texto longo',
    numero: 'Número',
    data: 'Data',
    selecao: 'Escolha única',
    multipla: 'Escolha múltipla',
    caixa: 'Caixa de marcar',
}

/** Para onde a resposta vai na ficha do contato. */
export const MAPEAMENTOS = ['nenhum', 'nome', 'telefone', 'email', 'observacoes'] as const
export type Mapeamento = (typeof MAPEAMENTOS)[number]

export const NOME_DO_MAPEAMENTO: Record<Mapeamento, string> = {
    nenhum: 'Só no envio',
    nome: 'Nome',
    telefone: 'Telefone',
    email: 'E-mail',
    observacoes: 'Observações',
}

export const MAX_CAMPOS = 30
export const MAX_OPCOES = 50

export const campoSchema = z.object({
    /** Estável entre edições: é a chave das respostas gravadas. */
    id: z.string().regex(/^[a-z0-9_-]{1,40}$/, 'id inválido'),
    tipo: z.enum(TIPOS_DE_CAMPO),
    rotulo: z.string().trim().min(1, 'Dê um nome ao campo').max(120, 'Rótulo longo demais'),
    ajuda: z.string().max(200).optional(),
    placeholder: z.string().max(120).optional(),
    obrigatorio: z.boolean().default(false),
    /** Metade divide a linha com o campo seguinte, quando a tela é larga. */
    largura: z.enum(['cheia', 'metade']).default('cheia'),
    opcoes: z.array(z.string().trim().min(1).max(80)).max(MAX_OPCOES).optional(),
    mapeia: z.enum(MAPEAMENTOS).default('nenhum'),
    validacao: z
        .object({
            /** Mínimo e máximo de caracteres (texto) ou valor (número). */
            min: z.number().int().min(0).max(100_000).optional(),
            max: z.number().int().min(0).max(100_000).optional(),
            /** Expressão regular, sem barras. Guardada curta e aplicada com guarda. */
            padrao: z.string().max(200).optional(),
        })
        .optional(),
})
export type Campo = z.infer<typeof campoSchema>

export const camposSchema = z.array(campoSchema).max(MAX_CAMPOS, `No máximo ${MAX_CAMPOS} campos`)

export const RAIOS = ['reto', 'suave', 'redondo'] as const
export const TEMAS = ['claro', 'escuro'] as const

export const configuracaoSchema = z.object({
    /** O título que aparece em cima do formulário. Vazio usa o nome. */
    titulo: z.string().max(120).default(''),
    descricao: z.string().max(500).default(''),
    textoDoBotao: z.string().trim().min(1, 'O botão precisa de um texto').max(40).default('Enviar'),
    mensagemDeSucesso: z
        .string()
        .max(500)
        .default('Recebemos seus dados. Em breve entraremos em contato.'),
    /** Depois do envio: para onde ir, se for para algum lugar. Vazio fica na mensagem. */
    redirecionarPara: z.string().max(500).default(''),
    aparencia: z
        .object({
            cor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'cor inválida'),
            raio: z.enum(RAIOS),
            tema: z.enum(TEMAS),
        })
        .default({ cor: BRAND_HEX.teal, raio: 'suave', tema: 'claro' }),
    /** Etiquetas que a ficha recebe ao chegar por este formulário. */
    tagIds: z.array(z.string().min(1).max(64)).max(20).default([]),
    /** Abre um negócio no funil padrão para cada lead. */
    criarNegocio: z.boolean().default(true),
    /** O texto do aceite (LGPD), quando a organização quer um. Vazio não mostra. */
    consentimento: z.string().max(300).default(''),
})
export type Configuracao = z.infer<typeof configuracaoSchema>

export const CONFIGURACAO_PADRAO: Configuracao = configuracaoSchema.parse({})

/** Os três campos com que todo formulário nasce — o mínimo de um lead. */
export function camposIniciais(): Campo[] {
    return [
        { id: 'nome', tipo: 'texto', rotulo: 'Nome', placeholder: 'Seu nome', obrigatorio: true, largura: 'cheia', mapeia: 'nome' },
        { id: 'whatsapp', tipo: 'telefone', rotulo: 'WhatsApp', placeholder: '(11) 99999-9999', obrigatorio: true, largura: 'metade', mapeia: 'telefone' },
        { id: 'email', tipo: 'email', rotulo: 'E-mail', placeholder: 'nome@exemplo.com.br', obrigatorio: false, largura: 'metade', mapeia: 'email' },
    ]
}

/** Lê o JSON gravado com tolerância: campo inválido sai, o resto fica. */
export function lerCampos(bruto: unknown): Campo[] {
    if (!Array.isArray(bruto)) return []
    const lidos: Campo[] = []
    for (const c of bruto) {
        const r = campoSchema.safeParse(c)
        if (r.success) lidos.push(r.data)
    }
    return lidos.slice(0, MAX_CAMPOS)
}

/** Lê a configuração gravada; chave a chave, para um campo quebrado não derrubar os outros. */
export function lerConfiguracao(bruto: unknown): Configuracao {
    const r = configuracaoSchema.safeParse(bruto ?? {})
    if (r.success) return r.data
    const parcial: Record<string, unknown> = {}
    const fonte = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
    for (const chave of Object.keys(configuracaoSchema.shape) as (keyof Configuracao)[]) {
        const campo = configuracaoSchema.shape[chave].safeParse(fonte[chave])
        if (campo.success) parcial[chave] = campo.data
    }
    return configuracaoSchema.parse(parcial)
}

/**
 * O que impede publicar. `null` quando pode.
 *
 * Um formulário sem jeito de falar com a pessoa depois — nem telefone nem
 * e-mail mapeado — captura resposta e não captura lead. Recusar aqui, antes de
 * ir ao ar, é o que evita descobrir isso com trinta envios sem contato.
 */
export function motivoParaNaoPublicar(campos: Campo[]): string | null {
    if (campos.length === 0) return 'O formulário não tem campos.'
    const falaCom = campos.some((c) => c.mapeia === 'telefone' || c.mapeia === 'email')
    if (!falaCom) return 'Pelo menos um campo precisa ir para Telefone ou E-mail — senão não há como falar com o lead.'
    const ids = new Set<string>()
    for (const c of campos) {
        if (ids.has(c.id)) return `Dois campos têm o mesmo id (${c.id}).`
        ids.add(c.id)
        if ((c.tipo === 'selecao' || c.tipo === 'multipla') && !(c.opcoes && c.opcoes.length > 0)) {
            return `"${c.rotulo}" é uma escolha sem opções.`
        }
    }
    return null
}

// ───────────────────────────── O envio ─────────────────────────────

export type Resposta = string | string[] | boolean | number

export type ResultadoDaValidacao =
    | { ok: true; valores: Record<string, Resposta> }
    | { ok: false; erros: Record<string, string> }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const DATA = /^\d{4}-\d{2}-\d{2}$/

/** Só os dígitos, com o 55 na frente quando é um número nacional sem país. */
export function digitosDoTelefone(valor: string): string {
    let d = valor.replace(/\D/g, '')
    if (d.startsWith('0')) d = d.replace(/^0+/, '')
    if (d.length === 10 || d.length === 11) d = `55${d}`
    return d
}

function textoDe(v: unknown): string {
    return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

/**
 * Valida um envio contra os campos, campo a campo, e devolve os valores já
 * normalizados — telefone em dígitos, e-mail em minúsculas, número como número.
 *
 * Erro por campo, não um erro só: a página pública põe cada um embaixo do
 * campo dele, como manda o DESIGN.md para qualquer formulário.
 */
export function validarEnvio(campos: Campo[], dados: Record<string, unknown>): ResultadoDaValidacao {
    const erros: Record<string, string> = {}
    const valores: Record<string, Resposta> = {}

    for (const campo of campos) {
        const cru = dados[campo.id]
        const falta = (msg = 'Preencha este campo') => {
            if (campo.obrigatorio) erros[campo.id] = msg
        }

        switch (campo.tipo) {
            case 'caixa': {
                const marcado = cru === true || cru === 'true' || cru === 'on' || cru === 1
                if (campo.obrigatorio && !marcado) {
                    erros[campo.id] = 'Marque esta opção para continuar'
                    break
                }
                valores[campo.id] = marcado
                break
            }
            case 'multipla': {
                const lista = Array.isArray(cru) ? cru.map(textoDe).filter(Boolean) : textoDe(cru) ? [textoDe(cru)] : []
                const validas = lista.filter((o) => campo.opcoes?.includes(o))
                if (validas.length === 0) {
                    falta('Escolha pelo menos uma opção')
                    break
                }
                valores[campo.id] = validas
                break
            }
            case 'selecao': {
                const v = textoDe(cru)
                if (!v) {
                    falta('Escolha uma opção')
                    break
                }
                if (!campo.opcoes?.includes(v)) {
                    erros[campo.id] = 'Opção inválida'
                    break
                }
                valores[campo.id] = v
                break
            }
            case 'numero': {
                const v = textoDe(cru).replace(',', '.')
                if (!v) {
                    falta()
                    break
                }
                const n = Number(v)
                if (!Number.isFinite(n)) {
                    erros[campo.id] = 'Informe um número'
                    break
                }
                if (campo.validacao?.min !== undefined && n < campo.validacao.min) {
                    erros[campo.id] = `O mínimo é ${campo.validacao.min}`
                    break
                }
                if (campo.validacao?.max !== undefined && n > campo.validacao.max) {
                    erros[campo.id] = `O máximo é ${campo.validacao.max}`
                    break
                }
                valores[campo.id] = n
                break
            }
            case 'data': {
                const v = textoDe(cru)
                if (!v) {
                    falta()
                    break
                }
                if (!DATA.test(v) || Number.isNaN(new Date(`${v}T12:00:00Z`).getTime())) {
                    erros[campo.id] = 'Informe uma data válida'
                    break
                }
                valores[campo.id] = v
                break
            }
            case 'email': {
                const v = textoDe(cru).toLowerCase()
                if (!v) {
                    falta()
                    break
                }
                if (!EMAIL.test(v) || v.length > 254) {
                    erros[campo.id] = 'Informe um e-mail válido'
                    break
                }
                valores[campo.id] = v
                break
            }
            case 'telefone': {
                const v = digitosDoTelefone(textoDe(cru))
                if (!v) {
                    falta()
                    break
                }
                if (v.length < 10 || v.length > 15) {
                    erros[campo.id] = 'Informe um telefone com DDD'
                    break
                }
                valores[campo.id] = v
                break
            }
            default: {
                // texto e paragrafo
                const v = textoDe(cru)
                if (!v) {
                    falta()
                    break
                }
                const teto = Math.min(campo.validacao?.max ?? (campo.tipo === 'paragrafo' ? 4000 : 500), 4000)
                if (v.length > teto) {
                    erros[campo.id] = `No máximo ${teto} caracteres`
                    break
                }
                if (campo.validacao?.min !== undefined && v.length < campo.validacao.min) {
                    erros[campo.id] = `No mínimo ${campo.validacao.min} caracteres`
                    break
                }
                if (campo.validacao?.padrao) {
                    try {
                        if (!new RegExp(campo.validacao.padrao).test(v)) {
                            erros[campo.id] = 'O valor não está no formato esperado'
                            break
                        }
                    } catch {
                        // Padrão inválido gravado: não pune quem preenche.
                    }
                }
                valores[campo.id] = v
            }
        }
    }

    return Object.keys(erros).length ? { ok: false, erros } : { ok: true, valores }
}

/** O que vai para a ficha, pelo mapeamento dos campos. */
export function extrairContato(
    campos: Campo[],
    valores: Record<string, Resposta>
): { nome?: string; telefone?: string; email?: string; observacoes?: string } {
    const saida: { nome?: string; telefone?: string; email?: string; observacoes?: string } = {}
    for (const campo of campos) {
        const v = valores[campo.id]
        if (v === undefined || v === '' || v === false) continue
        const texto = Array.isArray(v) ? v.join(', ') : String(v)
        if (campo.mapeia === 'nome' && !saida.nome) saida.nome = texto.slice(0, 120)
        if (campo.mapeia === 'telefone' && !saida.telefone) saida.telefone = texto
        if (campo.mapeia === 'email' && !saida.email) saida.email = texto.toLowerCase()
        if (campo.mapeia === 'observacoes') saida.observacoes = [saida.observacoes, texto].filter(Boolean).join('\n')
    }
    return saida
}

/** As respostas em texto, uma por linha, para a nota e para o negócio. */
export function resumoDasRespostas(campos: Campo[], valores: Record<string, Resposta>): string {
    return campos
        .map((campo) => {
            const v = valores[campo.id]
            if (v === undefined || v === '') return null
            const texto = Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v)
            return `${campo.rotulo}: ${texto}`
        })
        .filter((l): l is string => l !== null)
        .join('\n')
}

/** Um id de campo a partir do rótulo, único na lista. */
export function idParaCampo(rotulo: string, existentes: string[]): string {
    const base =
        rotulo
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 30) || 'campo'
    let id = base
    let n = 2
    while (existentes.includes(id)) id = `${base}-${n++}`
    return id
}
