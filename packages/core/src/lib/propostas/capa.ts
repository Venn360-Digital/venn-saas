import 'server-only'

import OpenAI from 'openai'

import { OPENAI_BASE_URL } from '../llm/base-url'
import { checkCredits, spendAiCredits, trackUsage } from '../llm/usage-tracker'
import { enderecoPara, gravar, referenciaDe } from '../storage'
import { CLASSES } from '../storage/classificacao'
import { chaveDe } from '../storage/tipos'
import type { Secao } from './secoes'

/**
 * A arte da capa, gerada por IA — fundo, nunca texto.
 *
 * ## A decisão (André, 22/11/2026)
 *
 * A IA gera **só a arte**: abstrata, nas cores da organização, sem letra
 * nenhuma. Título, cliente, data e logo são sobrepostos pelo produto como dados
 * dinâmicos — nítidos, editáveis e sem erro de grafia de modelo de imagem, que
 * erra palavra com frequência. O prompt proíbe texto, e o render põe o texto
 * por cima.
 *
 * ## Por onde passa, e quanto custa
 *
 * Pelo mesmo AI Gateway da OpenAI que o produto já usa (`OPENAI_BASE_URL`),
 * modelo `gpt-image-1`, formato retrato. O custo é por imagem, não por token:
 * `CREDITOS_POR_CAPA` é a estimativa em créditos (1 crédito = 1 centavo de
 * dólar, ver PRODUCT.md §2), debitada por `spendAiCredits`, e o uso fica em
 * `usage_logs` com token zero e o custo no `metadata` — o mesmo caminho da fala
 * (`trackSpeechUsage`).
 *
 * ## Onde mora
 *
 * No bucket **público**, porque a imagem não leva dado de cliente nenhum: é
 * arte. A chave é por unidade (`chaveDe`), como tudo o que se grava.
 */

/** Estimativa de custo de uma imagem média, em créditos. Ajustar quando a fatura disser outra coisa. */
export const CREDITOS_POR_CAPA = 8
const MODELO_DE_IMAGEM = 'gpt-image-1'

export interface EntradaDaCapa {
    workspaceId: string
    /** Do que trata o documento — para a arte ter assunto, não só cor. */
    assunto: string
    /** A cor principal, em hex, quando a organização tem uma. */
    cor?: string | null
    /** Quantas artes gerar de uma vez, para a pessoa escolher (1 a 3). */
    variacoes?: number
}

export interface OpcaoDeCapa {
    imageKey: string
    url: string
}

export type ResultadoDaCapa =
    | { ok: true; opcoes: OpcaoDeCapa[]; creditos: number }
    | { ok: false; motivo: string; status: number }

/** Teto de variações numa chamada: três cabem lado a lado e custam 24 créditos. */
export const MAXIMO_DE_VARIACOES = 3

export async function gerarCapa(entrada: EntradaDaCapa): Promise<ResultadoDaCapa> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return { ok: false, status: 503, motivo: 'a chave da OpenAI não está configurada neste ambiente' }

    const credito = await checkCredits(entrada.workspaceId)
    if (!credito.hasCredits) {
        return { ok: false, status: 402, motivo: 'Sem crédito de IA para gerar a capa. Compre créditos em Gerenciamento → Conta.' }
    }

    const n = Math.min(MAXIMO_DE_VARIACOES, Math.max(1, Math.trunc(entrada.variacoes ?? 1)))
    const cor = entrada.cor?.trim() || null
    const prompt = [
        'Abstract editorial cover background for a business proposal document.',
        `Subject mood: ${entrada.assunto.slice(0, 300)}.`,
        cor ? `Dominant color: ${cor}, with deep navy and soft light accents.` : 'Dominant colors: deep navy and teal, with soft light accents.',
        'Geometric or organic shapes, subtle gradients, generous empty space on the lower left for overlaid text.',
        'Absolutely NO text, NO letters, NO numbers, NO logos, NO watermarks, NO people faces.',
        'Clean, premium, print-ready. Portrait orientation.',
    ].join(' ')

    const cliente = new OpenAI({ apiKey, baseURL: OPENAI_BASE_URL })
    let imagens: string[] = []
    try {
        // Uma chamada com `n` variações: mesma cena, três leituras. É o que dá
        // escolha de verdade — três chamadas separadas divergiriam de assunto.
        const resposta = await cliente.images.generate({
            model: MODELO_DE_IMAGEM,
            prompt,
            n,
            size: '1024x1536',
            quality: 'medium',
        })
        imagens = (resposta.data ?? []).map((d) => d.b64_json).filter((b): b is string => !!b)
    } catch (erro) {
        console.error('[CAPA_IA]', erro)
        return { ok: false, status: 502, motivo: 'A geração da imagem falhou. Tente de novo em instantes.' }
    }
    if (imagens.length === 0) return { ok: false, status: 502, motivo: 'A geração não devolveu imagem.' }

    const base = Date.now().toString(36)
    const opcoes: OpcaoDeCapa[] = []
    let totalDeBytes = 0
    for (const [i, b64] of imagens.entries()) {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
        totalDeBytes += bytes.byteLength
        const chave = chaveDe(entrada.workspaceId, 'propostas', 'capas', `${base}-${i + 1}.png`)
        const ref = await gravar(CLASSES.PUBLICO, chave, bytes, { contentType: 'image/png' })
        opcoes.push({ imageKey: ref.chave, url: await enderecoPara(ref) })
    }

    // Custo por imagem gerada — as não escolhidas também custaram. Crédito
    // debitado e registro de uso com token zero.
    const creditos = CREDITOS_POR_CAPA * opcoes.length
    await spendAiCredits(entrada.workspaceId, creditos, opcoes.length === 1 ? 'capa do documento' : `${opcoes.length} variações de capa`)
    await trackUsage('openai', MODELO_DE_IMAGEM, { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 }, {
        workspaceId: entrada.workspaceId,
        metadata: { uso: 'capa_do_documento', creditos, imagens: opcoes.length, bytes: totalDeBytes },
    })

    return { ok: true, opcoes, creditos }
}

/** A URL pública da arte da capa, se alguma seção `capa` tiver `imageKey`. */
export async function urlDaCapaDe(secoes: readonly Secao[] | null | undefined): Promise<string | null> {
    const capa = secoes?.find((s) => s.tipo === 'capa')
    if (!capa || capa.tipo !== 'capa' || !capa.imageKey) return null
    try {
        return await enderecoPara(referenciaDe(CLASSES.PUBLICO, capa.imageKey, 'image/png'))
    } catch {
        return null
    }
}
