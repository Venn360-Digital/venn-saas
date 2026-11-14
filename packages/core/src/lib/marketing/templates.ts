import 'server-only'
import { Prisma } from '@venn/db'
import prisma from '@venn/db/cliente'
import type { SendTemplateInput } from '../whatsapp/types'
import { resolverLinhaOficial } from './lines'

/**
 * Sincroniza os templates aprovados de uma linha oficial com o espelho local.
 *
 * Os templates são criados e aprovados no painel da Meta — aqui só lemos e
 * guardamos, para a campanha escolher sem uma chamada à Graph a cada tela.
 * Upsert por (linha, nome, idioma): um template reprovado ou pausado atualiza o
 * `status` em vez de sumir, para a tela poder dizer por que não dá para usá-lo.
 *
 * Devolve quantos foram sincronizados, ou lança se a linha não for oficial.
 */
export async function sincronizarTemplates(
    workspaceId: string,
    integrationId: string
): Promise<{ total: number }> {
    const linha = await resolverLinhaOficial(workspaceId, integrationId)
    if (!linha) throw new Error('Linha oficial do WhatsApp não encontrada')

    const remotos = await linha.provider.listTemplates(linha.credentials)

    for (const t of remotos) {
        await prisma.whatsAppTemplate.upsert({
            where: {
                integrationId_metaName_language: {
                    integrationId,
                    metaName: t.name,
                    language: t.language,
                },
            },
            create: {
                workspaceId,
                integrationId,
                metaName: t.name,
                language: t.language,
                category: t.category,
                status: t.status,
                components: (t.components ?? []) as unknown as Prisma.InputJsonValue,
                syncedAt: new Date(),
            },
            update: {
                category: t.category,
                status: t.status,
                components: (t.components ?? []) as unknown as Prisma.InputJsonValue,
                syncedAt: new Date(),
            },
        })
    }

    return { total: remotos.length }
}

/** Os valores que a campanha preenche nos marcadores `{{n}}` do template. */
export interface BroadcastVariables {
    /** Variáveis do corpo, na ordem de `{{1}}`, `{{2}}`… */
    body?: string[]
    /** Variável única de um cabeçalho de texto, quando houver. */
    header?: string[]
}

/** Quantos marcadores `{{n}}` um texto tem. */
export function contarMarcadores(texto: string): number {
    const casados = texto.match(/\{\{\s*\d+\s*\}\}/g)
    return casados ? new Set(casados.map((m) => m.replace(/\D/g, ''))).size : 0
}

interface ComponenteMeta {
    type?: string
    format?: string
    text?: string
}

/**
 * Lê o espelho de um template e diz quantas variáveis ele pede.
 *
 * Só corpo de texto e cabeçalho de texto no MVP — cabeçalho de mídia e botões
 * com variável ficam de fora (ver DUVIDAS-B2.md). A tela usa isto para pedir os
 * valores certos; o envio usa `montarComponentes`.
 */
export function variaveisDoTemplate(components: unknown): { body: number; header: number } {
    const lista = Array.isArray(components) ? (components as ComponenteMeta[]) : []
    const body = lista.find((c) => (c.type ?? '').toUpperCase() === 'BODY')
    const header = lista.find((c) => (c.type ?? '').toUpperCase() === 'HEADER')
    return {
        body: body?.text ? contarMarcadores(body.text) : 0,
        header:
            header && (header.format ?? 'TEXT').toUpperCase() === 'TEXT' && header.text
                ? contarMarcadores(header.text)
                : 0,
    }
}

/**
 * Monta o `components` que a Graph espera, preenchendo as variáveis.
 *
 * Posicional: `vars.body[0]` → `{{1}}`, e assim por diante. Componente sem
 * variável não entra — a Meta recusa parâmetro a mais.
 */
export function montarComponentes(
    components: unknown,
    vars: BroadcastVariables
): Record<string, unknown>[] | undefined {
    const pedidas = variaveisDoTemplate(components)
    const out: Record<string, unknown>[] = []

    if (pedidas.header > 0 && vars.header && vars.header.length > 0) {
        out.push({
            type: 'header',
            parameters: vars.header.slice(0, pedidas.header).map((text) => ({ type: 'text', text })),
        })
    }
    if (pedidas.body > 0 && vars.body && vars.body.length > 0) {
        out.push({
            type: 'body',
            parameters: vars.body.slice(0, pedidas.body).map((text) => ({ type: 'text', text })),
        })
    }

    return out.length > 0 ? out : undefined
}

/**
 * O texto do corpo do template, com as variáveis já substituídas — para gravar
 * na conversa o que o paciente vai ler. A tela da clínica precisa **ler** o que
 * saiu, não só "[template X]".
 */
export function corpoRenderizado(components: unknown, vars: BroadcastVariables): string {
    const lista = Array.isArray(components) ? (components as ComponenteMeta[]) : []
    const body = lista.find((c) => (c.type ?? '').toUpperCase() === 'BODY')
    let texto = body?.text ?? ''
    const valores = vars.body ?? []
    texto = texto.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => valores[Number(n) - 1] ?? `{{${n}}}`)
    return texto
}

/** O payload de template pronto para o provedor, a partir do espelho + variáveis. */
export function prepararEnvioDeTemplate(
    template: { metaName: string; language: string; components: unknown },
    vars: BroadcastVariables
): SendTemplateInput {
    return {
        name: template.metaName,
        language: template.language,
        components: montarComponentes(template.components, vars),
    }
}
