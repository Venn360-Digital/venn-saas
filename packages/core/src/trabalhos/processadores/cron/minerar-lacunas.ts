import prisma from '@venn/db/cliente'
import { criarEmbeddings } from '../../../lib/rag/embeddings'
import { LLMFactory } from '../../../lib/llm/factory'
import { trackUsage } from '../../../lib/llm/usage-tracker'
import type { LLMProviderName } from '@/types/llm'
import {
    agrupar,
    normalizarPergunta,
    ordenarPorDemanda,
    type LacunaParaAgrupar,
} from '../../../lib/lacunas/agrupar'
import {
    ALVO_PADRAO,
    interpretarRascunho,
    promptDoRascunho,
    textoDoRascunho,
} from '../../../lib/lacunas/rascunho'
import { createLogger } from '../../registro'

const log = createLogger('MINERAR_LACUNAS')

/**
 * A mineração semanal: as perguntas que o agente não soube viram fila de
 * aprovação.
 *
 * É o *harvester* do laço de melhoria (§3.8 do estudo): o agente trabalha, isto
 * colhe o que faltou, e a pessoa aprova. Nada publica sozinho — a sugestão
 * aprovada entra como **rascunho** do documento, e dali ela ainda passa por
 * Publicar, que é onde a medição acontece.
 *
 * ## Por que semanal, e não ao vivo
 *
 * Agrupar exige ter o conjunto na mão: a terceira formulação de uma pergunta só
 * revela que as duas primeiras eram a mesma coisa. Minerar a cada lacuna
 * produziria um grupo de um, e depois outro, e a fila encheria de quase-duplicatas
 * — exatamente o que o agrupamento existe para evitar.
 *
 * ## O teto por agente, e por quê
 *
 * Cada grupo custa uma ida ao modelo para redigir a sugestão, e os embeddings
 * custam um por lacuna nova. Com o teto, a semana ruim de uma clínica tem preço
 * conhecido. Sem ele, um defeito no acervo que gere trezentas lacunas viraria
 * trezentas chamadas num domingo de manhã.
 */

/** Lacunas lidas por agente numa passada. */
const MAX_LACUNAS = 200

/** Sugestões redigidas por agente numa passada — é o que custa modelo. */
const MAX_SUGESTOES = 10

/**
 * Quantas lacunas um grupo precisa para virar sugestão.
 *
 * Uma só não vira: pergunta única pode ser alguém testando o agente, erro de
 * digitação, ou assunto que não é da clínica. Duas já é padrão, e é o mesmo
 * número que decide a escalada no passo 3 — pela mesma razão, que é "aconteceu
 * de novo".
 */
const DEMANDA_MINIMA = 2

export async function runMinerarLacunas(): Promise<void> {
    /**
     * Agentes **com lacuna não agrupada**, e não todos os agentes.
     *
     * `distinct` na lacuna em vez de varrer agentes: a maioria dos agentes não
     * tem lacuna nenhuma numa semana qualquer, e perguntar por agente seria uma
     * consulta por agente para descobrir isso.
     */
    const pendentes = await prisma.knowledgeGap.findMany({
        where: { suggestionId: null },
        distinct: ['agentId'],
        select: { agentId: true, workspaceId: true },
    })

    if (pendentes.length === 0) {
        log.info('nenhuma lacuna pendente de agrupamento')
        return
    }

    log.info(`minerando lacunas de ${pendentes.length} agente(s)`)

    for (const { agentId, workspaceId } of pendentes) {
        try {
            await minerarUmAgente(agentId, workspaceId)
        } catch (error) {
            // Um agente que falha não leva os outros: a mineração é por conta, e
            // a próxima semana tenta de novo.
            log.error(`falha ao minerar o agente ${agentId}`, error)
        }
    }
}

async function minerarUmAgente(agentId: string, workspaceId: string): Promise<void> {
    const lacunas = await prisma.knowledgeGap.findMany({
        where: { agentId, suggestionId: null },
        orderBy: { createdAt: 'asc' },
        take: MAX_LACUNAS,
        select: { id: true, question: true },
    })

    if (lacunas.length === 0) return

    /**
     * Repetição literal é descartada **antes** de pagar embedding.
     *
     * Vinte pessoas escrevendo "quanto custa?" são uma pergunta e um embedding.
     * O mapa guarda todos os ids da forma canônica, porque a demanda conta
     * **lacunas**, não formulações distintas — é o número que ordena a fila.
     */
    const porForma = new Map<string, { pergunta: string; ids: string[] }>()
    for (const l of lacunas) {
        const chave = normalizarPergunta(l.question)
        if (!chave) continue
        const atual = porForma.get(chave)
        if (atual) atual.ids.push(l.id)
        else porForma.set(chave, { pergunta: l.question.trim(), ids: [l.id] })
    }

    if (porForma.size === 0) {
        log.warn(`agente ${agentId}: nenhuma lacuna com texto aproveitável`)
        return
    }

    const formas = [...porForma.entries()]
    const embedder = criarEmbeddings()
    const vetores = await embedder.embedDocuments(formas.map(([, v]) => v.pergunta))

    const itens: LacunaParaAgrupar[] = formas.map(([chave, v], i) => ({
        // O id do item é a **forma canônica**, não o id da lacuna: o agrupamento
        // trabalha sobre formulações, e a expansão para ids vem depois.
        id: chave,
        pergunta: v.pergunta,
        vetor: vetores[i] ?? [],
    }))

    const grupos = ordenarPorDemanda(agrupar(itens)).filter((g) => {
        const quantas = g.ids.reduce((s, chave) => s + (porForma.get(chave)?.ids.length ?? 0), 0)
        return quantas >= DEMANDA_MINIMA
    })

    if (grupos.length === 0) {
        log.info(`agente ${agentId}: nenhum grupo alcançou demanda ${DEMANDA_MINIMA}`)
        return
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent) return

    const redator = LLMFactory.create(agent.llmProvider as LLMProviderName, {
        model: agent.llmModel,
        // Zero: redigir pergunta não é criar. Variação aqui só faria a mesma
        // lacuna produzir cabeçalhos diferentes entre semanas.
        temperature: 0,
    })

    let redigidas = 0

    for (const grupo of grupos.slice(0, MAX_SUGESTOES)) {
        const idsDeLacuna = grupo.ids.flatMap((chave) => porForma.get(chave)?.ids ?? [])
        const demanda = idsDeLacuna.length
        const variacoes = grupo.ids.map((chave) => porForma.get(chave)?.pergunta ?? chave)

        let lido = null
        try {
            const r = await redator.generate([
                { role: 'system', content: 'Você organiza base de conhecimento. Siga o formato à risca.' },
                { role: 'user', content: promptDoRascunho({ ...grupo, demanda }, variacoes) },
            ])

            try {
                await trackUsage(agent.llmProvider as LLMProviderName, agent.llmModel, r.usage, {
                    workspaceId,
                    agentId,
                    // Canal próprio: isto é custo de melhoria, não de atendimento,
                    // e misturar os dois faria a margem parecer pior na semana em
                    // que a mineração trabalhou mais.
                    metadata: { channel: 'mineracao' },
                })
            } catch (error) {
                log.error('usage tracking falhou', error)
            }

            lido = interpretarRascunho(r.content)
        } catch (error) {
            log.error(`falha ao redigir sugestão do agente ${agentId}`, error)
        }

        /**
         * Saída ilegível **não** vira sugestão com alvo chutado.
         *
         * A lacuna fica como está e a próxima semana tenta de novo. Gravar uma
         * sugestão com `targetSlug` adivinhado poria a pergunta no documento
         * errado, e quem aprova não tem como saber que o alvo foi um palpite.
         */
        if (!lido) {
            log.warn(`agente ${agentId}: sugestão ilegível, grupo de ${demanda} lacuna(s) fica para a próxima`)
            continue
        }

        const sugestao = await prisma.gapSuggestion.create({
            data: {
                workspaceId,
                agentId,
                question: grupo.representante.pergunta,
                demand: demanda,
                targetSlug: lido.alvo || ALVO_PADRAO,
                draftText: textoDoRascunho(lido, demanda),
            },
            select: { id: true },
        })

        /**
         * As lacunas são marcadas **depois** de a sugestão existir.
         *
         * Se a marcação viesse antes e a criação falhasse, as lacunas ficariam
         * apontando para nada e sairiam da próxima mineração — perdidas em
         * silêncio, que é o pior desfecho para o material que o passo 5 existe
         * para colher.
         */
        await prisma.knowledgeGap.updateMany({
            where: { id: { in: idsDeLacuna }, agentId },
            data: { suggestionId: sugestao.id, status: 'agrupada' },
        })

        redigidas++
    }

    log.info(`agente ${agentId}: ${redigidas} sugestão(ões) de ${grupos.length} grupo(s)`)
}
