import 'server-only'

import { z } from 'zod'

import prisma from '@venn/db/cliente'

import { LLMFactory } from '../llm/factory'
import { DEFAULT_MODEL } from '../llm/models'
import { trackUsage } from '../llm/usage-tracker'
import { comArtigo } from '../concordancia'
import type { Vocabulario } from '../vocabulario'
import { ehTipoDeDocumento, ROTULO_DO_TIPO, type TipoDeDocumento } from './estados'

/**
 * O rascunho da proposta, escrito pela IA a partir do que o negócio já sabe.
 *
 * ## O que ela faz, e o que ela deliberadamente não faz
 *
 * **Faz:** lê o negócio, o contato, as últimas mensagens da conversa e o
 * catálogo ATIVO da unidade, e devolve uma lista de itens do catálogo com
 * quantidade, mais um texto de observação. É o uso que paga o módulo: o vendedor
 * abre a proposta já preenchida e corrige, em vez de montar de zero.
 *
 * **Não faz:** inventar item que não está no catálogo, inventar preço, e dar
 * desconto. Os três por uma razão só — preço e desconto são compromisso
 * comercial, e um modelo que os escolhe compromete a unidade sem ninguém ter
 * aprovado. A IA escolhe **quais** itens e **quantos**; o valor sai do
 * catálogo, e o desconto é do vendedor.
 *
 * É a mesma regra dos passos de funil (`scripts/check-funil.ts`: "nenhum passo
 * de mensagem traz texto pronto"): o que a máquina escreve nunca promete o que
 * nós não sabemos.
 *
 * ## Por que structured output, e não tool calling
 *
 * Tool calling devolve os argumentos como string — "JSON, e nem sempre válido".
 * Para o agente de conversa isso serve: ferramenta malformada vira uma tentativa
 * perdida. Aqui, um JSON quebrado cairia como lista vazia e o vendedor veria uma
 * tela em branco sem saber se o catálogo está vazio ou se a chamada falhou.
 * `generateEstruturado` com `strict: true` faz a API recusar a geração que não
 * casa o schema. Ver a nota em `types/llm.ts`.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Uso 2: redigir o texto do documento
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O que ela escreve, e a linha que ela não cruza.
 *
 * **Escreve:** a introdução, o escopo — "o que será feito" em prosa, a partir
 * dos itens que já estão na proposta e do que a conversa disse. É o pedaço que
 * o vendedor mais adia, porque é redação.
 *
 * **Não escreve:** preço, prazo, forma de pagamento, garantia, e **cláusula
 * jurídica**. Os quatro primeiros porque são compromisso comercial que o modelo
 * não tem como saber. O último merece parágrafo próprio.
 *
 * ## Contrato: a IA ajuda a redigir, não a minutar
 *
 * O pedido original falava em "contratos de forma inteligente, com auxílio da
 * IA", e o template de contrato deste módulo já diz no próprio corpo que é uma
 * moldura, não uma minuta. As duas coisas convivem, e a fronteira é esta:
 *
 *   - ela **descreve o objeto** do contrato a partir dos itens — isso é
 *     redação, e é onde ela ajuda de verdade;
 *   - ela **não inventa cláusula** de rescisão, multa, foro, confidencialidade
 *     ou responsabilidade. Cláusula gerada por modelo entra num documento que
 *     alguém assina, e quem assina é que responde por ela.
 *
 * Quem precisa de cláusula escreve no modelo, uma vez, e ela passa a valer para
 * todo contrato daquela unidade. A IA então **adapta o escopo** dentro dela.
 *
 * Isso está no prompt e está na tela. Não é um aviso para nos proteger: é a
 * diferença entre uma ferramenta que economiza meia hora de redação e uma que
 * produz um documento que ninguém leu.
 */

/**
 * A lista de pedidos vem de um módulo NEUTRO, e é reexportada aqui.
 *
 * A tela precisa dela para montar os botões, e **não pode importar este
 * arquivo**: ele é `server-only` e carrega o Prisma. O `next build` reprovou
 * com `Can't resolve 'pg'` quando ela importava daqui. Ver `./pedidos.ts`.
 */
import {
    PEDIDOS_DE_TEXTO,
    ROTULO_DO_PEDIDO,
    reescreveTextoExistente,
    type PedidoDeTexto,
} from './pedidos'

export { PEDIDOS_DE_TEXTO, ROTULO_DO_PEDIDO, reescreveTextoExistente, type PedidoDeTexto }

/**
 * Por que o pedido é uma lista fechada, e não um campo livre.
 *
 * Instrução livre num documento que vai ao cliente é a porta por onde entra
 * "escreva que damos garantia de 5 anos" — e o modelo escreveria, porque foi
 * pedido. Com quatro pedidos nomeados, cada um tem o seu próprio freio no
 * prompt, e o que a ferramenta faz é previsível para quem a usa.
 *
 * `encurtar` e `formalizar` operam sobre o texto que a PESSOA escreveu: ali o
 * modelo não acrescenta fato nenhum, só reescreve. São os dois usos de menor
 * risco e, provavelmente, os mais frequentes.
 */
function instrucaoDoPedido(pedido: PedidoDeTexto, tipo: TipoDeDocumento): string {
    const ehContrato = tipo === 'contrato'

    const comum = [
        'Escreva em português do Brasil, claro e direto.',
        'NUNCA escreva preço, valor, desconto, prazo de entrega, forma de pagamento ou garantia.',
        'Não cumprimente, não se despeça e não assine — o modelo do documento já cuida disso.',
        'Responda APENAS com o texto final, sem explicação e sem aspas em volta.',
        ehContrato
            ? 'Este é um CONTRATO: descreva o objeto a partir dos itens. NÃO escreva cláusula de rescisão, multa, foro, confidencialidade, responsabilidade ou qualquer outra disposição jurídica — essas vêm do modelo que a organização já aprovou.'
            : '',
    ]
        .filter(Boolean)
        .join(' ')

    const especifico: Record<PedidoDeTexto, string> = {
        introducao:
            'Escreva um parágrafo curto de abertura, dizendo o que este documento cobre. No máximo três frases.',
        escopo:
            'Descreva em prosa o que será feito, a partir dos itens listados. Uma frase por item, agrupando o que for da mesma natureza. Não repita a tabela: explique.',
        encurtar:
            'Reescreva o texto abaixo com menos palavras, mantendo TODOS os fatos e compromissos que ele já tem. Não acrescente nada que não esteja nele.',
        formalizar:
            'Reescreva o texto abaixo em registro mais formal, mantendo TODOS os fatos. Não acrescente nada que não esteja nele.',
    }

    return `${especifico[pedido]} ${comum}`
}

export interface EntradaDoTexto {
    workspaceId: string
    propostaId: string
    pedido: PedidoDeTexto
    /** O que já está escrito. Obrigatório para `encurtar` e `formalizar`. */
    textoAtual?: string | null
    vocabulario: Vocabulario
}

export type ResultadoDoTexto = { ok: true; texto: string } | { ok: false; motivo: string }

export async function redigirTexto(entrada: EntradaDoTexto): Promise<ResultadoDoTexto> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
        return { ok: false, motivo: 'a chave da OpenAI não está configurada neste ambiente' }
    }

    const reescrita = reescreveTextoExistente(entrada.pedido)
    const atual = (entrada.textoAtual ?? '').trim()
    if (reescrita && atual.length < 20) {
        return {
            ok: false,
            motivo: 'escreva algo primeiro — este pedido reescreve o que já está no campo',
        }
    }

    const proposta = await prisma.proposal.findFirst({
        where: { id: entrada.propostaId, workspaceId: entrada.workspaceId, deletedAt: null },
        select: {
            kind: true,
            title: true,
            workspace: { select: { name: true } },
            deal: { select: { title: true, contact: { select: { name: true } } } },
            currentRevision: {
                select: {
                    items: {
                        orderBy: { order: 'asc' },
                        select: {
                            description: true,
                            quantity: true,
                            productService: { select: { unit: true } },
                        },
                    },
                },
            },
        },
    })
    if (!proposta) return { ok: false, motivo: 'proposta não encontrada' }

    const tipo: TipoDeDocumento = ehTipoDeDocumento(proposta.kind) ? proposta.kind : 'proposta'
    const itens = proposta.currentRevision?.items ?? []

    if (itens.length === 0 && entrada.pedido === 'escopo') {
        return {
            ok: false,
            motivo: 'acrescente os itens primeiro — o escopo é escrito a partir deles',
        }
    }

    /**
     * O contexto NÃO leva preço.
     *
     * Dar o valor ao modelo e pedir que não o escreva é confiar numa instrução
     * contra uma tentação que não precisava existir. Sem o número, ele não tem
     * o que vazar. A quantidade vai, porque "duas sessões" é escopo.
     */
    const contexto = [
        `Documento: ${ROTULO_DO_TIPO[tipo]} — ${proposta.title}`,
        `Quem emite: ${proposta.workspace.name}`,
        proposta.deal.contact?.name ? `Para: ${proposta.deal.contact.name}` : '',
        `Negócio: ${proposta.deal.title}`,
        '',
        itens.length > 0 ? 'Itens deste documento:' : 'Este documento ainda não tem itens.',
        ...itens.map(
            (i) =>
                `- ${i.description}${Number(i.quantity) !== 1 ? ` (${Number(i.quantity)}${i.productService?.unit ? ' ' + i.productService.unit : 'x'})` : ''}`
        ),
        reescrita ? `\nTexto a reescrever:\n${atual}` : '',
    ]
        .filter(Boolean)
        .join('\n')

    const llm = LLMFactory.create('openai', {
        apiKey,
        model: DEFAULT_MODEL,
        // Mais alta que a do rascunho de itens: aqui o que se quer é redação, e
        // 0.3 produz texto rígido. O que não pode variar está no prompt, não na
        // temperatura.
        temperature: 0.6,
        maxTokens: 900,
        promptCacheKey: `proposta-texto:${entrada.pedido}:${tipo}`,
    })

    const resposta = await llm.generate([
        { role: 'system', content: instrucaoDoPedido(entrada.pedido, tipo) },
        { role: 'user', content: contexto },
    ])

    await trackUsage('openai', DEFAULT_MODEL, resposta.usage, {
        workspaceId: entrada.workspaceId,
        metadata: { uso: 'texto_de_proposta', pedido: entrada.pedido, propostaId: entrada.propostaId },
    })

    const texto = resposta.content.trim()
    if (texto.length === 0) {
        return { ok: false, motivo: 'o modelo não devolveu texto' }
    }

    /**
     * `finishReason === 'length'` significa resposta CORTADA pelo teto.
     *
     * Sem este teste, o vendedor recebe um parágrafo que termina no meio de uma
     * frase e o sistema registra sucesso — o mesmo defeito que o comentário de
     * `LLMResponse.finishReason` descreve para o agente de conversa.
     */
    if (resposta.finishReason === 'length') {
        return { ok: false, motivo: 'o texto foi cortado antes de terminar; tente um pedido mais curto' }
    }

    return { ok: true, texto }
}

// ═══════════════════════════════════════════════════════════════════════════
// Uso 1: o rascunho de itens
// ═══════════════════════════════════════════════════════════════════════════

/** O teto de itens que a IA pode sugerir. Proposta é documento, não catálogo. */
const MAX_ITENS_SUGERIDOS = 12
/** Quantas mensagens da conversa entram no contexto. */
const MENSAGENS_DE_CONTEXTO = 30
/** Quantos itens do catálogo são oferecidos ao modelo. */
const MAX_ITENS_DO_CATALOGO = 200

/**
 * O que o modelo pode devolver.
 *
 * Valida o que `strict: true` já deveria garantir, e a redundância é
 * proposital: a garantia é do provedor, e um provedor é um terceiro. O que
 * **não** é redundante é o teste de pertinência ao catálogo, abaixo — nenhum
 * schema impede o modelo de inventar um id.
 */
const sugestaoSchema = z.object({
    itens: z
        .array(
            z.object({
                productServiceId: z.string(),
                quantity: z.number().positive().max(999),
                /** Por que este item entrou. Vai para a tela, não para o documento. */
                motivo: z.string().max(200),
            })
        )
        .max(MAX_ITENS_SUGERIDOS),
    /** O texto de observação sugerido, para o campo da revisão. */
    observacao: z.string().max(2000),
    titulo: z.string().max(200),
})

/** O JSON Schema que vai à API. Modo estrito exige `required` completo. */
const SCHEMA_DA_SUGESTAO = {
    type: 'object',
    properties: {
        titulo: { type: 'string', description: 'Um título curto para o documento' },
        itens: {
            type: 'array',
            description: 'Os itens do catálogo que compõem este documento',
            items: {
                type: 'object',
                properties: {
                    productServiceId: {
                        type: 'string',
                        description: 'O id EXATO de um item da lista fornecida. Nunca invente um id.',
                    },
                    quantity: { type: 'number', description: 'Quantas unidades deste item' },
                    motivo: {
                        type: 'string',
                        description: 'Em uma frase, por que este item entrou',
                    },
                },
                required: ['productServiceId', 'quantity', 'motivo'],
                additionalProperties: false,
            },
        },
        observacao: {
            type: 'string',
            description:
                'Observação para o documento. Nunca prometa prazo, condição de pagamento ou garantia.',
        },
    },
    required: ['titulo', 'itens', 'observacao'],
    additionalProperties: false,
} as const

export interface ItemSugerido {
    productServiceId: string
    description: string
    unitPrice: number
    quantity: number
    motivo: string
    unit: string | null
}

export type ResultadoDaSugestao =
    | { ok: true; titulo: string; observacao: string; itens: ItemSugerido[] }
    | { ok: false; motivo: string }

/**
 * O prompt.
 *
 * Prefixo estável primeiro, cauda volátil depois — a ordem que o cache de
 * prompt da OpenAI premia, e a mesma disciplina de
 * `trabalhos/servicos/prompt.ts`. O que é estável: as regras. O que é volátil:
 * o negócio, a conversa e o catálogo desta unidade.
 */
function instrucoes(v: Vocabulario, tipo: TipoDeDocumento): string {
    const aOrganizacao = comArtigo(v, 'organizacao')
    const oServico = ROTULO_DO_TIPO[tipo].toLowerCase()

    return [
        `Você monta o rascunho de um documento comercial (${oServico}) para ${aOrganizacao}.`,
        '',
        'Regras, todas obrigatórias:',
        '1. Escolha itens APENAS da lista de catálogo fornecida, pelo id exato. Nunca invente um id nem um item.',
        '2. Não escreva preço, desconto, forma de pagamento, prazo de entrega nem garantia. Esses valores vêm do catálogo e do vendedor.',
        '3. Escolha a quantidade a partir do que a conversa e o negócio indicam. Na dúvida, 1.',
        '4. Se a conversa não deixar claro o que a pessoa quer, devolva a lista de itens VAZIA e explique na observação o que falta perguntar. Uma lista errada custa mais que uma lista vazia.',
        '5. A observação é para quem recebe o documento: português claro, sem jargão, sem saudação e sem assinatura.',
        '6. O título descreve o conjunto em poucas palavras.',
    ].join('\n')
}

export interface EntradaDaSugestao {
    workspaceId: string
    dealId: string
    tipo: TipoDeDocumento
    vocabulario: Vocabulario
    /** Para o registro de custo, quando houver agente associado. */
    agentId?: string
}

export async function sugerirRascunho(entrada: EntradaDaSugestao): Promise<ResultadoDaSugestao> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
        return { ok: false, motivo: 'a chave da OpenAI não está configurada neste ambiente' }
    }

    const negocio = await prisma.deal.findFirst({
        where: { id: entrada.dealId, workspaceId: entrada.workspaceId },
        select: {
            title: true,
            value: true,
            notes: true,
            contactId: true,
            contact: { select: { name: true, notes: true } },
            origin: { select: { name: true } },
            stage: { select: { name: true } },
        },
    })
    if (!negocio) return { ok: false, motivo: 'negócio não encontrado' }

    /**
     * Só o catálogo ATIVO entra.
     *
     * Oferecer item inativo ao modelo o faria sugerir um procedimento que a
     * unidade tirou da tabela — e é exatamente para isso que `isActive` existe.
     */
    const catalogo = await prisma.productService.findMany({
        where: { workspaceId: entrada.workspaceId, isActive: true },
        orderBy: [{ group: 'asc' }, { name: 'asc' }],
        take: MAX_ITENS_DO_CATALOGO,
        select: { id: true, name: true, description: true, price: true, unit: true, group: true },
    })

    if (catalogo.length === 0) {
        return {
            ok: false,
            motivo: 'o catálogo desta unidade está vazio — cadastre itens antes de pedir um rascunho',
        }
    }

    /**
     * As últimas mensagens da conversa do contato.
     *
     * É de onde sai o que a pessoa pediu, com as palavras dela. Sem isto o
     * modelo só tem o título do negócio, e o rascunho vira um chute sobre o
     * catálogo inteiro.
     */
    const mensagens = negocio.contactId
        ? await prisma.message.findMany({
              where: {
                  conversation: { workspaceId: entrada.workspaceId, contactId: negocio.contactId },
                  contentType: 'text',
              },
              orderBy: { createdAt: 'desc' },
              take: MENSAGENS_DE_CONTEXTO,
              select: { direction: true, content: true, createdAt: true },
          })
        : []

    const contexto = [
        `Negócio: ${negocio.title}`,
        negocio.stage?.name ? `Etapa do funil: ${negocio.stage.name}` : '',
        negocio.contact?.name ? `Pessoa atendida: ${negocio.contact.name}` : '',
        negocio.origin?.name ? `Origem: ${negocio.origin.name}` : '',
        negocio.notes ? `Anotações do negócio: ${negocio.notes}` : '',
        negocio.contact?.notes ? `Anotações da pessoa: ${negocio.contact.notes}` : '',
        '',
        'Catálogo disponível (use APENAS estes ids):',
        ...catalogo.map(
            (i) =>
                `- id=${i.id} | ${i.name}${i.group ? ` [${i.group}]` : ''}${
                    i.unit ? ` (por ${i.unit})` : ''
                }${i.description ? ` — ${i.description.slice(0, 160)}` : ''}`
        ),
        '',
        mensagens.length > 0 ? 'Conversa, da mais recente para a mais antiga:' : 'Não há conversa registrada.',
        ...mensagens.map(
            (m) => `[${m.direction === 'inbound' ? 'pessoa' : 'equipe'}] ${String(m.content).slice(0, 400)}`
        ),
    ]
        .filter(Boolean)
        .join('\n')

    const llm = LLMFactory.create('openai', {
        apiKey,
        model: DEFAULT_MODEL,
        // Baixa, mas não zero: a observação precisa soar escrita, e o que não
        // pode variar (os ids, a estrutura) está travado pelo schema.
        temperature: 0.3,
        maxTokens: 2000,
        // O prefixo estável é o das instruções; a cauda é o contexto.
        promptCacheKey: `proposta:${entrada.tipo}`,
    })

    if (!llm.generateEstruturado) {
        return { ok: false, motivo: 'este provedor não oferece resposta estruturada' }
    }

    const resposta = await llm.generateEstruturado(
        [
            { role: 'system', content: instrucoes(entrada.vocabulario, entrada.tipo) },
            { role: 'user', content: contexto },
        ],
        { nome: 'rascunho_de_documento', schema: SCHEMA_DA_SUGESTAO as unknown as Record<string, unknown> }
    )

    // O custo é registrado onde já é — mesmo quando a resposta não serviu: o
    // token foi gasto, e esconder isso da conta falsearia a margem.
    await trackUsage('openai', DEFAULT_MODEL, resposta.usage, {
        workspaceId: entrada.workspaceId,
        agentId: entrada.agentId,
        metadata: { uso: 'rascunho_de_proposta', dealId: entrada.dealId },
    })

    if (resposta.recusa) return { ok: false, motivo: resposta.recusa }

    const validada = sugestaoSchema.safeParse(resposta.dados)
    if (!validada.success) {
        return { ok: false, motivo: 'a resposta do modelo não veio na forma esperada' }
    }

    /**
     * O teste que nenhum schema faz: o id existe NESTE catálogo?
     *
     * `strict: true` garante que `productServiceId` é uma string — não que seja
     * um id real. Um modelo que alucina um id plausível passaria pelo schema e
     * o item entraria na proposta sem preço, ou pior, com a FK apontando para
     * nada. Itens desconhecidos são descartados em silêncio: o vendedor revisa
     * a lista antes de enviar, e um aviso técnico ali não o ajudaria.
     */
    const porId = new Map(catalogo.map((i) => [i.id, i]))
    const itens: ItemSugerido[] = []
    for (const sugerido of validada.data.itens) {
        const doCatalogo = porId.get(sugerido.productServiceId)
        if (!doCatalogo) continue
        itens.push({
            productServiceId: doCatalogo.id,
            description: doCatalogo.name,
            // O preço vem do CATÁLOGO, nunca do modelo. Ver o cabeçalho.
            unitPrice: doCatalogo.price ?? 0,
            quantity: sugerido.quantity,
            motivo: sugerido.motivo,
            unit: doCatalogo.unit,
        })
    }

    return {
        ok: true,
        titulo: validada.data.titulo,
        observacao: validada.data.observacao,
        itens,
    }
}
