import 'server-only'

import { z } from 'zod'

import { comArtigo } from '../concordancia'
import { LLMFactory } from '../llm/factory'
import { DEFAULT_MODEL } from '../llm/models'
import { trackUsage } from '../llm/usage-tracker'
import type { Vocabulario } from '../vocabulario'
import { ROTULO_DO_TIPO, type TipoDeDocumento } from './estados'
import {
    CHAVES_SUGERIVEIS,
    esvaziarCompromissos,
    SCHEMA_DAS_SECOES_PLANAS,
    secoesDaResposta,
    type Secao,
    type SecaoPlana,
    type SugestaoDeVariavel,
} from './secoes'
import { separarTabelas } from './planilha'
import { GRUPOS, REGISTRO } from './variaveis'

/**
 * A IA que monta o MODELO — e a que lê um documento importado.
 *
 * ## "Modelo primeiro, documento depois"
 *
 * A ordem é do André (22/11/2026): quem monta o modelo é quem pensa a venda,
 * uma vez; quem cria o documento está com o cliente na linha. Então a IA
 * trabalha aqui, no modelo — nunca no documento individual, onde o contexto é
 * só cliente e itens.
 *
 * ## O que a IA escreve, e o que deixa em branco
 *
 * Escreve **apresentação**: carta, escopo, nome das fases, títulos. Deixa em
 * branco **compromisso**: número de resultado, prazo, preço, garantia, cláusula
 * — porque prometer é de quem assina. O prompt pede; `esvaziarCompromissos`
 * garante em código, e o verificador cobra. Um modelo que obedecesse só por
 * instrução obedeceria até o dia em que não obedecesse.
 *
 * ## Variáveis, não valores
 *
 * O modelo recebe a lista de tokens que existem (`{{cliente.nome}}`,
 * `{{documento.total}}`…) e escreve o texto com eles. É o que faz o modelo
 * servir a qualquer cliente — e é por isso que o passo 3 da tela ("marcar o
 * que varia") raramente dá trabalho.
 *
 * ## Custo
 *
 * Registrado em `trackUsage` como todo uso de IA — inclusive quando a resposta
 * não serviu: o token foi gasto.
 */

const respostaSchema = z.object({
    secoes: z.array(
        z.object({
            tipo: z.string(),
            titulo: z.string().nullable(),
            corpo: z.string().nullable(),
            linhas: z.array(z.object({ a: z.string(), b: z.string(), c: z.string().nullable(), d: z.string().nullable() })),
        })
    ),
})

/** A lista de tokens, para o prompt — só os em grupo, nunca os apelidos. */
function tokensDisponiveis(): string {
    return GRUPOS.flatMap((g) => Object.entries(REGISTRO[g]).map(([c, rotulo]) => `{{${g}.${c}}} — ${rotulo.toLowerCase()}`)).join('\n')
}

function regrasComuns(v: Vocabulario): string[] {
    return [
        `Escreva em português do Brasil, no tom de ${comArtigo(v, 'organizacao')} falando com ${comArtigo(v, 'pessoa', 'um')}.`,
        'Onde entraria o nome do cliente, da organização, uma data, um valor ou um dado do responsável, use EXATAMENTE um destes tokens, nunca um valor inventado:',
        tokensDisponiveis(),
        '',
        'Compromisso é de quem assina. Em "destaques" deixe o campo a (valor) VAZIO; em "fases" deixe b (prazo) VAZIO; em "investimento" deixe b (valor) VAZIO; em "garantia" deixe b (texto) VAZIO; em "condicoes" deixe corpo VAZIO. Preencha os títulos e rótulos para a pessoa saber o que falta.',
        'Nunca escreva preço, prazo, garantia, multa, forma de pagamento nem percentual de resultado.',
        '',
        'A tabela de itens e valores é a seção "itens": ela não tem conteúdo, só o título.',
        'Linhas (a, b, c, d) por tipo: destaques = valor, rótulo, legenda; escopo = título, descrição; fases = nome, prazo, responsável, descrição; investimento = título, valor, período, o que inclui separado por ";"; garantia = título, texto; fechamento = a primeira linha traz a chamada curta ("Obrigado."). Nos outros tipos, linhas vazia.',
        'No tipo "capa", corpo é o subtítulo (uma frase).',
    ]
}

export interface EntradaDoModelo {
    workspaceId: string
    tipo: TipoDeDocumento
    vocabulario: Vocabulario
    /** O que a pessoa escreveu: o que vende, para quem, tom, seções que quer. */
    descricao: string
}

export type ResultadoDoModelo =
    | { ok: true; secoes: Secao[]; nome: string }
    | { ok: false; motivo: string }

/** Monta um modelo inteiro a partir da descrição. */
export async function montarModelo(entrada: EntradaDoModelo): Promise<ResultadoDoModelo> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return { ok: false, motivo: 'a chave da OpenAI não está configurada neste ambiente' }

    const descricao = entrada.descricao.trim()
    if (descricao.length < 10) return { ok: false, motivo: 'Descreva um pouco mais: o que vende, para quem e que seções quer.' }

    const rotulo = ROTULO_DO_TIPO[entrada.tipo].toLowerCase()
    const sistema = [
        `Você monta o MODELO de um documento comercial (${rotulo}) — todas as páginas e seções, com texto de apresentação pronto.`,
        '',
        'Estrutura típica de uma proposta completa, nesta ordem: capa, sumario, carta, destaques, escopo, fases, itens, investimento, garantia, condicoes, aceite, fechamento. Um orçamento usa só: texto curto, itens, condicoes, aceite. Um contrato: capa, e depois UMA seção "texto" por cláusula, com título "Cláusula N — Do(a) …" (partes, objeto, vigência, valor e pagamento, obrigações de cada parte, confidencialidade, proteção de dados, rescisão, foro), depois itens e aceite; dentro das cláusulas, prazo, multa, forma de pagamento e foro ficam escritos como "(a definir)". Use o que a descrição pedir; na dúvida, a estrutura típica do tipo.',
        '',
        ...regrasComuns(entrada.vocabulario),
    ].join('\n')

    const llm = LLMFactory.create('openai', {
        apiKey,
        model: DEFAULT_MODEL,
        temperature: 0.5,
        maxTokens: 4000,
        promptCacheKey: `modelo:${entrada.tipo}`,
    })
    if (!llm.generateEstruturado) return { ok: false, motivo: 'este provedor não oferece resposta estruturada' }

    const resposta = await llm.generateEstruturado(
        [
            { role: 'system', content: sistema },
            { role: 'user', content: descricao },
        ],
        { nome: 'modelo_de_documento', schema: SCHEMA_DAS_SECOES_PLANAS as unknown as Record<string, unknown> }
    )

    await trackUsage('openai', DEFAULT_MODEL, resposta.usage, {
        workspaceId: entrada.workspaceId,
        metadata: { uso: 'modelo_de_documento', tipo: entrada.tipo },
    })

    if (resposta.recusa) return { ok: false, motivo: resposta.recusa }
    const validada = respostaSchema.safeParse(resposta.dados)
    if (!validada.success) return { ok: false, motivo: 'a resposta do modelo não veio na forma esperada' }

    const secoes = esvaziarCompromissos(secoesDaResposta(validada.data.secoes as SecaoPlana[]))
    if (secoes.length === 0) return { ok: false, motivo: 'o modelo não devolveu nenhuma seção reconhecível' }

    // O nome do modelo sai da descrição, curto: as primeiras palavras.
    const nome = `${ROTULO_DO_TIPO[entrada.tipo]} — ${descricao.split(/[.\n]/)[0].slice(0, 60).trim()}`
    return { ok: true, secoes, nome }
}

// ── importar ─────────────────────────────────────────────────────────────

const SCHEMA_DA_IMPORTACAO = {
    type: 'object',
    properties: {
        ...SCHEMA_DAS_SECOES_PLANAS.properties,
        valores: {
            type: 'array',
            description: 'Trechos LITERAIS do documento que são dados que mudam de cliente para cliente, e qual dado cada um é.',
            items: {
                type: 'object',
                properties: {
                    literal: { type: 'string', description: 'O trecho exatamente como aparece no texto' },
                    chave: { type: 'string', enum: [...CHAVES_SUGERIVEIS] },
                },
                required: ['literal', 'chave'],
                additionalProperties: false,
            },
        },
    },
    required: ['secoes', 'valores'],
    additionalProperties: false,
} as const

const importacaoSchema = respostaSchema.extend({
    valores: z.array(z.object({ literal: z.string(), chave: z.string() })),
})

export interface EntradaDaImportacao {
    workspaceId: string
    tipo: TipoDeDocumento
    vocabulario: Vocabulario
    /** O texto extraído do arquivo (`lib/documentos/extrair.ts`), já normalizado. */
    texto: string
    nomeDoArquivo: string
}

export type ResultadoDaImportacao =
    | { ok: true; secoes: Secao[]; sugestoes: SugestaoDeVariavel[]; nome: string }
    | { ok: false; motivo: string }

/**
 * Lê um documento que a organização já usa e o devolve em seções — com os
 * dados que variam **sugeridos**, não trocados.
 *
 * A troca é da pessoa, uma a uma (`aplicarSugestoes`): "Helena Prado" num
 * contrato antigo é quase certamente o nome do cliente, mas é a pessoa quem
 * sabe. O que a IA entrega é o reconhecimento; o que ela NÃO faz é esvaziar
 * compromisso — o documento importado é da organização, e os valores dela
 * ficam até ela decidir.
 */
export async function lerDocumentoImportado(entrada: EntradaDaImportacao): Promise<ResultadoDaImportacao> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return { ok: false, motivo: 'a chave da OpenAI não está configurada neste ambiente' }

    const bruto = entrada.texto.trim()
    if (bruto.length < 40) return { ok: false, motivo: 'O arquivo tem pouco texto legível. PDF só de imagem não é lido.' }

    // Tabelas de planilha viram seção em código, antes da IA (ver `planilha.ts`):
    // o que resta do texto é o que o modelo lê.
    const separado = separarTabelas(bruto)
    const texto = separado.texto.trim() || bruto

    const sistema = [
        `Você recebe o texto de um documento comercial (${ROTULO_DO_TIPO[entrada.tipo].toLowerCase()}) que uma organização já usa, e o devolve dividido em seções, SEM reescrever: preserve as frases do original.`,
        'Reconheça a estrutura: capa (título e subtítulo no começo), carta ou texto de apresentação, destaques (números com rótulo), escopo (lista de entregas), fases (etapas com prazo), itens (tabela de itens/valores), investimento (preços), garantia, condicoes (cláusulas), aceite, fechamento (agradecimento e contato). Use "texto" para o que não couber em outro tipo.',
        'Em "valores", liste os trechos literais que são dados de um cliente ou de um documento específico — nome da pessoa, nome da empresa emissora, CNPJ, data, valor total, nome do responsável — e qual dado cada um é. Só trechos que aparecem EXATAMENTE no texto.',
        '',
        'Não invente seção que o documento não tem. Não preencha campos vazios. Linhas (a, b, c, d) por tipo: destaques = valor, rótulo, legenda; escopo = título, descrição; fases = nome, prazo, responsável, descrição; investimento = título, valor, período, o que inclui separado por ";"; garantia = título, texto; fechamento = a primeira linha traz a chamada curta.',
    ].join('\n')

    const llm = LLMFactory.create('openai', {
        apiKey,
        model: DEFAULT_MODEL,
        temperature: 0.1,
        maxTokens: 6000,
        promptCacheKey: `importar:${entrada.tipo}`,
    })
    if (!llm.generateEstruturado) return { ok: false, motivo: 'este provedor não oferece resposta estruturada' }

    const resposta = await llm.generateEstruturado(
        [
            { role: 'system', content: sistema },
            // Teto generoso, mas teto: um contrato de 60 páginas não cabe num
            // modelo e não deveria virar um.
            { role: 'user', content: texto.slice(0, 60_000) },
        ],
        { nome: 'documento_importado', schema: SCHEMA_DA_IMPORTACAO as unknown as Record<string, unknown> }
    )

    await trackUsage('openai', DEFAULT_MODEL, resposta.usage, {
        workspaceId: entrada.workspaceId,
        metadata: { uso: 'importar_modelo', tipo: entrada.tipo, arquivo: entrada.nomeDoArquivo },
    })

    if (resposta.recusa) return { ok: false, motivo: resposta.recusa }
    const validada = importacaoSchema.safeParse(resposta.dados)
    if (!validada.success) return { ok: false, motivo: 'a resposta do modelo não veio na forma esperada' }

    const secoes = [...secoesDaResposta(validada.data.secoes as SecaoPlana[]), ...separado.secoes]
    if (secoes.length === 0) return { ok: false, motivo: 'não foi possível reconhecer seções neste documento' }

    // Só o que de fato aparece no texto e tem tamanho de dado: o schema garante
    // a chave, não a honestidade do literal.
    const vistas = new Set<string>()
    const sugestoes: SugestaoDeVariavel[] = []
    for (const s of validada.data.valores) {
        const literal = s.literal.trim()
        if (literal.length < 3 || !bruto.includes(literal)) continue
        if (!(CHAVES_SUGERIVEIS as readonly string[]).includes(s.chave)) continue
        const marca = `${s.chave}:${literal}`
        if (vistas.has(marca)) continue
        vistas.add(marca)
        sugestoes.push({ literal, chave: s.chave })
    }

    const nome = `${ROTULO_DO_TIPO[entrada.tipo]} — ${entrada.nomeDoArquivo.replace(/\.(pdf|docx|xlsx)$/i, '').slice(0, 60)}`
    return { ok: true, secoes, sugestoes, nome }
}
