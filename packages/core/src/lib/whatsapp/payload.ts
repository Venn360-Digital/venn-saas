/**
 * Decoding of the WhatsApp protobuf message object.
 *
 * Shared by both providers on purpose: whatsmeow (Evolution Go) and the Meta
 * Cloud API (Evolution v2) both hand us the same wire-level `Message` shape, keyed
 * by which `*Message` field is present. Only the envelope around it differs, and
 * that lives in ./envelopes.ts.
 *
 * Kept free of IO so it can be unit-tested against recorded webhook bodies.
 */

/**
 * A WhatsApp protobuf message object. No provider publishes a schema for it, so
 * it is read defensively rather than typed structurally.
 */
export type WhatsAppMessagePayload = Record<string, Record<string, unknown> | string | undefined>

/** The provider's `data` object wrapping the payload. */
export type EvolutionData = Record<string, unknown>

export type ContentType = 'text' | 'image' | 'audio' | 'video' | 'file' | 'reaction'

export interface DecodedMessage {
    content: string
    contentType: ContentType
    mediaUrl: string | null
    /**
     * A chave do payload que ninguém reconheceu, quando caiu no marcador de
     * "não suportado". Para o log — a tela não a mostra, mas sem ela cada tipo
     * novo que o WhatsApp inventar fica invisível até alguém abrir o payload.
     */
    tipoDesconhecido?: string
}

/**
 * Os textos que este decodificador **inventa** quando a mensagem não traz
 * palavra nenhuma de quem escreveu — áudio, mídia sem legenda, sticker,
 * localização.
 *
 * Ficam aqui, numa definição só, e o predicado abaixo é exportado porque **quem
 * monta a consulta do Cérebro precisa distingui-los de texto de verdade**. A
 * busca por similaridade usava o `content` cru, então uma nota de voz procurava
 * no acervo pela string "🎵 Áudio" — que não casa com nada, e o paciente que
 * mandou áudio era atendido **sem base de conhecimento alguma**. O agente
 * respondia, só respondia pior, e por isso ninguém viu.
 *
 * Copiar esta lista para o outro módulo traria de volta a forma de defeito mais
 * comum deste sistema: um valor em dois lugares, e o segundo não acompanha. Se
 * um marcador novo nascer aqui, a busca já o reconhece.
 */
const MARCADOR_VAZIO = '[Mensagem vazia]'
const MARCADOR_NAO_SUPORTADO = '[Tipo de mensagem não suportado]'
const MARCADOR_AUDIO = '🎵 Áudio'
const MARCADOR_IMAGEM = '📷 Imagem'
const MARCADOR_VIDEO = '🎬 Vídeo'
const MARCADOR_STICKER = '🏷️ Sticker'
/** Estes carregam uma parte variável, então são reconhecidos pelo começo. */
const PREFIXO_DOCUMENTO = '📄 '
const PREFIXO_CONTATO = '👤 Contato:'
const PREFIXO_CONTATOS = '👤 Contatos:'
const PREFIXO_LOCALIZACAO = '📍 Localização:'
const PREFIXO_LOCALIZACAO_AO_VIVO = '📍 Localização em tempo real:'
const PREFIXO_ENQUETE = '📊 Enquete:'
const PREFIXO_CONVITE = '🔗 Convite para o grupo'
const PREFIXO_PEDIDO = '🛒 Pedido'
const PREFIXO_PRODUTO = '🛍️ Produto:'
const PREFIXO_EVENTO = '📅 Evento:'

const MARCADORES_EXATOS: ReadonlySet<string> = new Set([
    MARCADOR_VAZIO,
    MARCADOR_NAO_SUPORTADO,
    MARCADOR_AUDIO,
    MARCADOR_IMAGEM,
    MARCADOR_VIDEO,
    MARCADOR_STICKER,
])

const MARCADORES_POR_PREFIXO: readonly string[] = [
    PREFIXO_DOCUMENTO,
    PREFIXO_CONTATO,
    PREFIXO_CONTATOS,
    PREFIXO_LOCALIZACAO,
    PREFIXO_LOCALIZACAO_AO_VIVO,
    PREFIXO_ENQUETE,
    PREFIXO_CONVITE,
    PREFIXO_PEDIDO,
    PREFIXO_PRODUTO,
    PREFIXO_EVENTO,
]

/** O marcador de figurinha — para a tela não repetir a legenda sob a imagem. */
export function ehMarcadorDeSticker(content: string): boolean {
    return content.trim() === MARCADOR_STICKER
}

/**
 * As chaves que **não** são conteúdo: metadado de criptografia, protocolo
 * (apagar, fixar, guardar, expirar), distribuição de chave de grupo. Uma
 * mensagem que só tem isto não é mensagem de ninguém para ninguém, e gravá-la
 * como "[Tipo de mensagem não suportado]" era exatamente o balão de erro que
 * a atendente via sem motivo. Ver `ehSoProtocolo`.
 */
const CHAVES_SEM_CONTEUDO: ReadonlySet<string> = new Set([
    'messageContextInfo',
    'protocolMessage',
    'senderKeyDistributionMessage',
    'pinInChatMessage',
    'keepInChatMessage',
    'pollUpdateMessage',
    'encReactionMessage',
    'encCommentMessage',
    'deviceSentMessage',
    'messageSecret',
])

/** A mensagem é só protocolo — nada para mostrar nem para responder. */
function ehSoProtocolo(payload: WhatsAppMessagePayload): boolean {
    const chaves = Object.keys(payload).filter((k) => payload[k] !== undefined && payload[k] !== null)
    return chaves.length > 0 && chaves.every((k) => CHAVES_SEM_CONTEUDO.has(k))
}

/**
 * Se este texto foi inventado aqui em vez de escrito por quem mandou.
 *
 * Nome de arquivo e nome de contato **contam como marcador**: são rótulo, não
 * pergunta, e buscar o acervo por "orçamento.pdf" só traz ruído.
 */
export function ehMarcadorDeMidia(content: string): boolean {
    const texto = content.trim()
    if (texto.length === 0) return true
    if (MARCADORES_EXATOS.has(texto)) return true
    return MARCADORES_POR_PREFIXO.some((prefixo) => texto.startsWith(prefixo))
}

/**
 * Os invólucros do WhatsApp: mensagens que **contêm** a mensagem de verdade.
 *
 * Mensagem temporária, de ver-uma-vez e documento-com-legenda não são tipos de
 * conteúdo — são embalagens, e a fala da pessoa está um nível abaixo, em
 * `.message`. Sem desembrulhar, `decodeMessage` não reconhece nenhuma chave
 * conhecida e cai no "[Tipo de mensagem não suportado]": uma foto enviada como
 * ver-uma-vez aparecia para a atendente como erro, não como foto.
 *
 * `editedMessage` entra na lista porque a edição carrega o texto novo dentro da
 * mesma estrutura; mostrar o texto novo é exatamente o que se quer.
 */
const INVOLUCROS = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
    'editedMessage',
] as const

/**
 * Tira as embalagens até sobrar a mensagem.
 *
 * Com teto de profundidade, porque invólucro aninhado existe (temporária
 * contendo ver-uma-vez) e um payload malformado não pode virar laço infinito no
 * caminho de uma mensagem de paciente.
 */
export function desembrulhar(
    payload: WhatsAppMessagePayload,
    profundidade = 0
): WhatsAppMessagePayload {
    if (profundidade >= 4) return payload

    for (const chave of INVOLUCROS) {
        const embalagem = payload[chave]
        if (!embalagem || typeof embalagem !== 'object') continue

        const dentro = (embalagem as Record<string, unknown>).message
        if (dentro && typeof dentro === 'object') {
            return desembrulhar(dentro as WhatsAppMessagePayload, profundidade + 1)
        }
    }

    return payload
}

/**
 * O id da mensagem que o paciente **apagou**, quando o evento é isso.
 *
 * ## O defeito que isto conserta
 *
 * Apagar uma mensagem no WhatsApp não apaga nada do nosso lado: chega um evento
 * novo, um `protocolMessage` de tipo `REVOKE`, que diz "aquela mensagem lá não
 * existe mais". `decodeMessage` não conhecia essa chave, caía no último
 * `return` e o sistema **gravava uma mensagem nova** com o texto
 * "[Tipo de mensagem não suportado]" — ao lado da original, que continuava ali.
 *
 * Então a atendente via duas coisas erradas de uma vez: a mensagem que o
 * paciente apagou, ainda visível, e um balão de erro que não era erro de nada.
 * Foi relatado assim: "quando o paciente apaga a mensagem fica aparecendo como
 * tipo de mensagem não suportado".
 *
 * `null` para todo o resto, inclusive para os outros `protocolMessage` — o tipo
 * cobre também expiração de mensagem temporária e pedido de chave de histórico,
 * que não são apagamento e não devem marcar nada como apagado.
 */
export function idDaMensagemRevogada(
    payload: WhatsAppMessagePayload | undefined
): string | null {
    const protocolo = payload?.protocolMessage
    if (!protocolo || typeof protocolo !== 'object') return null

    const bloco = protocolo as Record<string, unknown>
    const tipo = String(bloco.type ?? '').toUpperCase()
    // `REVOKE` é o nome no whatsmeow; o número 0 é como o protobuf cru o
    // serializa quando o campo não é traduzido para o nome do enum.
    if (tipo !== 'REVOKE' && tipo !== '0') return null

    const chave = bloco.key
    if (!chave || typeof chave !== 'object') return null

    const id = (chave as Record<string, unknown>).ID ?? (chave as Record<string, unknown>).id
    return typeof id === 'string' && id.length > 0 ? id : null
}

/** Read a nested field without asserting the whole payload's shape. */
function field(payload: WhatsAppMessagePayload, group: string, key: string): string | undefined {
    const value = payload[group]
    if (!value || typeof value !== 'object') return undefined
    const inner = (value as Record<string, unknown>)[key]
    return typeof inner === 'string' && inner.length > 0 ? inner : undefined
}

function has(payload: WhatsAppMessagePayload, group: string): boolean {
    return Boolean(payload[group])
}

/** Prefer the URL Evolution resolved; fall back to the raw (encrypted) one. */
function mediaUrlFor(payload: WhatsAppMessagePayload, data: EvolutionData, group: string): string | null {
    const fromEvolution = typeof data.mediaUrl === 'string' ? data.mediaUrl : undefined
    return fromEvolution ?? field(payload, group, 'url') ?? null
}

export function decodeMessage(
    payload: WhatsAppMessagePayload | undefined,
    data: EvolutionData
): DecodedMessage {
    if (!payload) return { content: MARCADOR_VAZIO, contentType: 'text', mediaUrl: null }

    // Antes de procurar o tipo, tira a embalagem: temporária, ver-uma-vez e
    // documento-com-legenda guardam a mensagem um nível abaixo, e sem isto toda
    // uma delas aparecia como "não suportado". Ver `INVOLUCROS`.
    payload = desembrulhar(payload)

    const conversation = payload.conversation
    if (typeof conversation === 'string' && conversation.length > 0) {
        return { content: conversation, contentType: 'text', mediaUrl: null }
    }

    // Text with a link preview, mention or reply attached.
    const extended = field(payload, 'extendedTextMessage', 'text')
    if (extended) return { content: extended, contentType: 'text', mediaUrl: null }

    if (has(payload, 'imageMessage')) {
        return {
            content: field(payload, 'imageMessage', 'caption') ?? MARCADOR_IMAGEM,
            contentType: 'image',
            mediaUrl: mediaUrlFor(payload, data, 'imageMessage'),
        }
    }

    if (has(payload, 'audioMessage')) {
        return {
            content: MARCADOR_AUDIO,
            contentType: 'audio',
            mediaUrl: mediaUrlFor(payload, data, 'audioMessage'),
        }
    }

    if (has(payload, 'videoMessage')) {
        return {
            content: field(payload, 'videoMessage', 'caption') ?? MARCADOR_VIDEO,
            contentType: 'video',
            mediaUrl: mediaUrlFor(payload, data, 'videoMessage'),
        }
    }

    if (has(payload, 'documentMessage')) {
        const fileName = field(payload, 'documentMessage', 'fileName') ?? 'Documento'
        return {
            content: `${PREFIXO_DOCUMENTO}${fileName}`,
            contentType: 'file',
            mediaUrl: mediaUrlFor(payload, data, 'documentMessage'),
        }
    }

    /**
     * Nota de vídeo (o círculo gravado segurando o botão): é vídeo, e vai como
     * vídeo — antes caía no "não suportado".
     */
    if (has(payload, 'ptvMessage')) {
        return {
            content: field(payload, 'ptvMessage', 'caption') ?? MARCADOR_VIDEO,
            contentType: 'video',
            mediaUrl: mediaUrlFor(payload, data, 'ptvMessage'),
        }
    }

    /**
     * Figurinha: imagem **com** mídia, desde 20/11/2026. Saía com `mediaUrl`
     * nulo, e a bolha mostrava o texto "🏷️ Sticker" no lugar da figurinha —
     * que é o que a atendente chamava de "não suportado". É WebP, que a tela
     * desenha; o agente não a recebe (ver `ehImagemAnexavel`).
     */
    if (has(payload, 'stickerMessage')) {
        return {
            content: MARCADOR_STICKER,
            contentType: 'image',
            mediaUrl: mediaUrlFor(payload, data, 'stickerMessage'),
        }
    }

    if (has(payload, 'contactMessage')) {
        const name = field(payload, 'contactMessage', 'displayName') ?? 'N/A'
        const telefone = telefoneDoVcard(field(payload, 'contactMessage', 'vcard'))
        return {
            content: `${PREFIXO_CONTATO} ${name}${telefone ? ` · ${telefone}` : ''}`,
            contentType: 'text',
            mediaUrl: null,
        }
    }

    // Vários contatos de uma vez: o cartão de cada um, numa linha.
    if (has(payload, 'contactsArrayMessage')) {
        const bloco = payload.contactsArrayMessage as Record<string, unknown>
        const lista = Array.isArray(bloco.contacts) ? (bloco.contacts as Record<string, unknown>[]) : []
        const linhas = lista.map((c) => {
            const nome = typeof c.displayName === 'string' && c.displayName ? c.displayName : 'Sem nome'
            const tel = telefoneDoVcard(typeof c.vcard === 'string' ? c.vcard : undefined)
            return `• ${nome}${tel ? ` · ${tel}` : ''}`
        })
        return {
            content: `${PREFIXO_CONTATOS}\n${linhas.join('\n') || '• (vazio)'}`,
            contentType: 'text',
            mediaUrl: null,
        }
    }

    if (has(payload, 'locationMessage')) {
        const location = payload.locationMessage as Record<string, unknown>
        const nome = [location.name, location.address].filter((x) => typeof x === 'string' && x).join(' — ')
        return {
            content: `${PREFIXO_LOCALIZACAO} ${nome ? `${nome} · ` : ''}${location.degreesLatitude}, ${location.degreesLongitude}`,
            contentType: 'text',
            mediaUrl: null,
        }
    }

    if (has(payload, 'liveLocationMessage')) {
        const location = payload.liveLocationMessage as Record<string, unknown>
        const legenda = typeof location.caption === 'string' && location.caption ? ` — ${location.caption}` : ''
        return {
            content: `${PREFIXO_LOCALIZACAO_AO_VIVO} ${location.degreesLatitude}, ${location.degreesLongitude}${legenda}`,
            contentType: 'text',
            mediaUrl: null,
        }
    }

    /**
     * Enquete (as três versões do protobuf): a pergunta e as opções. O voto
     * (`pollUpdateMessage`) vem cifrado e sem nome, e é descartado em
     * `ehSoProtocolo` — não há como saber em que a pessoa votou.
     */
    for (const chave of ['pollCreationMessageV3', 'pollCreationMessageV2', 'pollCreationMessage'] as const) {
        if (!has(payload, chave)) continue
        const bloco = payload[chave] as Record<string, unknown>
        const opcoes = Array.isArray(bloco.options)
            ? (bloco.options as Record<string, unknown>[])
                  .map((o) => (typeof o.optionName === 'string' ? o.optionName : ''))
                  .filter(Boolean)
            : []
        return {
            content: `${PREFIXO_ENQUETE} ${typeof bloco.name === 'string' ? bloco.name : ''}${
                opcoes.length ? `\n${opcoes.map((o) => `• ${o}`).join('\n')}` : ''
            }`.trim(),
            contentType: 'text',
            mediaUrl: null,
        }
    }

    /**
     * Resposta a botão, lista ou fluxo interativo: o que a pessoa escolheu é o
     * texto dela. Chegava como "não suportado" sempre que uma campanha com
     * botões recebia o clique — justamente a resposta que a campanha pedia.
     */
    const escolha =
        field(payload, 'buttonsResponseMessage', 'selectedDisplayText') ??
        field(payload, 'buttonsResponseMessage', 'selectedButtonId') ??
        field(payload, 'templateButtonReplyMessage', 'selectedDisplayText') ??
        field(payload, 'templateButtonReplyMessage', 'selectedId') ??
        field(payload, 'listResponseMessage', 'title') ??
        tituloDaListaEscolhida(payload) ??
        textoDaRespostaInterativa(payload)
    if (escolha) return { content: escolha, contentType: 'text', mediaUrl: null }

    if (has(payload, 'groupInviteMessage')) {
        const nome = field(payload, 'groupInviteMessage', 'groupName') ?? 'sem nome'
        const legenda = field(payload, 'groupInviteMessage', 'caption')
        return {
            content: `${PREFIXO_CONVITE} "${nome}"${legenda ? ` — ${legenda}` : ''}`,
            contentType: 'text',
            mediaUrl: null,
        }
    }

    if (has(payload, 'orderMessage')) {
        const bloco = payload.orderMessage as Record<string, unknown>
        const itens = typeof bloco.itemCount === 'number' ? `${bloco.itemCount} item(ns)` : 'itens'
        const titulo = typeof bloco.orderTitle === 'string' && bloco.orderTitle ? ` — ${bloco.orderTitle}` : ''
        const texto = typeof bloco.message === 'string' && bloco.message ? `\n${bloco.message}` : ''
        return { content: `${PREFIXO_PEDIDO} (${itens})${titulo}${texto}`, contentType: 'text', mediaUrl: null }
    }

    if (has(payload, 'productMessage')) {
        const bloco = payload.productMessage as Record<string, unknown>
        const produto = (bloco.product ?? {}) as Record<string, unknown>
        const titulo = typeof produto.title === 'string' && produto.title ? produto.title : 'sem título'
        const descricao = typeof produto.description === 'string' && produto.description ? ` — ${produto.description}` : ''
        return { content: `${PREFIXO_PRODUTO} ${titulo}${descricao}`, contentType: 'text', mediaUrl: null }
    }

    if (has(payload, 'eventMessage')) {
        const bloco = payload.eventMessage as Record<string, unknown>
        const nome = typeof bloco.name === 'string' && bloco.name ? bloco.name : 'sem nome'
        const descricao = typeof bloco.description === 'string' && bloco.description ? ` — ${bloco.description}` : ''
        const quando = typeof bloco.startTime === 'string' || typeof bloco.startTime === 'number'
            ? ` · ${new Date(Number(bloco.startTime) * 1000).toISOString()}`
            : ''
        return { content: `${PREFIXO_EVENTO} ${nome}${descricao}${quando}`, contentType: 'text', mediaUrl: null }
    }

    // Reactions carry no conversational content; the caller drops them.
    if (has(payload, 'reactionMessage')) {
        return { content: '', contentType: 'reaction', mediaUrl: null }
    }

    // Só protocolo (fixar, guardar, expirar, voto cifrado, chave de grupo):
    // nada a mostrar. Sai como reação, que é o que o chamador já descarta.
    if (ehSoProtocolo(payload)) {
        return { content: '', contentType: 'reaction', mediaUrl: null }
    }

    const desconhecida = Object.keys(payload).find((k) => !CHAVES_SEM_CONTEUDO.has(k))
    return { content: MARCADOR_NAO_SUPORTADO, contentType: 'text', mediaUrl: null, tipoDesconhecido: desconhecida }
}

/** O primeiro telefone de um vCard, como o WhatsApp o grava (`TEL;…:+55…`). */
function telefoneDoVcard(vcard: string | undefined): string | null {
    if (!vcard) return null
    const m = /^TEL[^:\n]*:(.+)$/im.exec(vcard)
    if (!m) return null
    const digitos = m[1].replace(/\D/g, '')
    return digitos.length >= 8 ? `+${digitos}` : null
}

/** O título da linha escolhida numa lista, que mora dois níveis abaixo. */
function tituloDaListaEscolhida(payload: WhatsAppMessagePayload): string | undefined {
    const lista = payload.listResponseMessage
    if (!lista || typeof lista !== 'object') return undefined
    const resposta = (lista as Record<string, unknown>).singleSelectReply
    if (!resposta || typeof resposta !== 'object') return undefined
    const id = (resposta as Record<string, unknown>).selectedRowId
    return typeof id === 'string' && id ? id : undefined
}

/**
 * O que a pessoa respondeu num fluxo interativo (`interactiveResponseMessage`):
 * o texto do corpo, ou o JSON de parâmetros do fluxo nativo, que é onde o
 * botão clicado fica.
 */
function textoDaRespostaInterativa(payload: WhatsAppMessagePayload): string | undefined {
    const bloco = payload.interactiveResponseMessage
    if (!bloco || typeof bloco !== 'object') return undefined
    const b = bloco as Record<string, unknown>
    const corpo = b.body && typeof b.body === 'object' ? (b.body as Record<string, unknown>).text : undefined
    if (typeof corpo === 'string' && corpo) return corpo
    const nativo = b.nativeFlowResponseMessage
    if (nativo && typeof nativo === 'object') {
        const params = (nativo as Record<string, unknown>).paramsJson
        if (typeof params === 'string' && params) {
            try {
                const lido = JSON.parse(params) as Record<string, unknown>
                const texto = lido.description ?? lido.title ?? lido.id
                if (typeof texto === 'string' && texto) return texto
            } catch {
                return params
            }
        }
    }
    return undefined
}
