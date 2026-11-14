/**
 * Os recibos do SES, normalizados.
 *
 * Lógica pura: nenhuma consulta, nenhum binding. O processador da fila decide o
 * que gravar; aqui só se lê o envelope e se diz o que ele significa.
 *
 * O SES publica o evento como JSON **dentro** do campo `Message` do SNS, que é
 * uma string. Então são dois `JSON.parse` aninhados, e é fácil errar qual é
 * qual — por isso a leitura mora aqui e não espalhada.
 */

/** Os tipos que o configuration set publica. */
export type TipoDeEvento =
    | 'Send'
    | 'Delivery'
    | 'Bounce'
    | 'Complaint'
    | 'Reject'
    | 'Open'
    | 'Click'
    | 'Subscription'
    | 'DeliveryDelay'
    | 'RenderingFailure'

export interface EventoDoSes {
    tipo: TipoDeEvento
    /** O `MessageId` do envio. É por ele que o destinatário é encontrado. */
    messageId: string
    /** Quando o evento aconteceu, segundo o SES. */
    em: Date
    /** Os destinatários a que o evento se refere. */
    destinatarios: string[]
    /**
     * Só em `Bounce`: `Permanent` é endereço que não existe e nunca vai
     * existir; `Transient` é caixa cheia ou servidor fora do ar, e **volta a
     * funcionar**. Tratar os dois igual descadastraria quem só estava de férias
     * com a caixa cheia.
     */
    bounceDuro?: boolean
    /** Motivo legível, para a coluna de erro do destinatário. */
    motivo?: string
    /**
     * A passagem de funil que mandou este e-mail, quando foi um funil.
     *
     * Sai da tag `funnelRun`, que `acoes.ts` carimba no envio. Existe por um
     * motivo estreito e importante: o e-mail de funil **não tem**
     * `BroadcastRecipient`, então sem esta pista o recibo não acha o workspace,
     * e um bounce duro deixaria de gravar `Contact.emailOptOutAt`.
     *
     * O efeito disso, medido em homologação antes do conserto: o funil
     * continuaria mandando para um endereço que quica, a cada passo e a cada
     * passagem nova — e é reclamação acumulada que derruba a reputação do
     * domínio do cliente.
     */
    funnelRunId?: string
}

function texto(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined
}

function objeto(v: unknown): Record<string, unknown> {
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

/** O primeiro valor de uma tag do SES, que chega sempre como lista. */
function primeiroDaTag(v: unknown): string | undefined {
    if (!Array.isArray(v)) return undefined
    return v.find((x): x is string => typeof x === 'string' && x.length > 0)
}

/**
 * Lê o corpo do evento do SES (o conteúdo de `Message` do SNS).
 *
 * Devolve `null` para o que não é evento conhecido — incluindo a mensagem de
 * teste que o console do SNS manda ao criar a assinatura, que chega como texto
 * solto e não como JSON.
 */
export function lerEventoDoSes(cru: string): EventoDoSes | null {
    let valor: unknown
    try {
        valor = JSON.parse(cru)
    } catch {
        return null
    }

    const raiz = objeto(valor)
    const tipo = texto(raiz.eventType) ?? texto(raiz.notificationType)
    if (!tipo) return null

    const mail = objeto(raiz.mail)
    const messageId = texto(mail.messageId)
    if (!messageId) return null

    const destinatarios = Array.isArray(mail.destination)
        ? mail.destination.filter((d): d is string => typeof d === 'string')
        : []

    /**
     * As tags que o envio carimbou voltam em `mail.tags`, e sempre como
     * **lista** de valores — é a forma do SES, não um erro de leitura.
     */
    const tags = objeto(mail.tags)
    const funnelRunId = primeiroDaTag(tags.funnelRun)

    const base = {
        messageId,
        destinatarios,
        em: new Date(texto(mail.timestamp) ?? Date.now()),
        ...(funnelRunId ? { funnelRunId } : {}),
    }

    switch (tipo) {
        case 'Bounce': {
            const b = objeto(raiz.bounce)
            const destinatariosDoBounce = Array.isArray(b.bouncedRecipients)
                ? b.bouncedRecipients
                      .map((r) => texto(objeto(r).emailAddress))
                      .filter((e): e is string => Boolean(e))
                : []
            return {
                ...base,
                tipo: 'Bounce',
                // Só o endereço que de fato quicou, não todos do envio.
                destinatarios: destinatariosDoBounce.length ? destinatariosDoBounce : destinatarios,
                em: new Date(texto(b.timestamp) ?? base.em),
                bounceDuro: texto(b.bounceType) === 'Permanent',
                motivo: [texto(b.bounceType), texto(b.bounceSubType)].filter(Boolean).join('/'),
            }
        }

        case 'Complaint': {
            const c = objeto(raiz.complaint)
            const reclamantes = Array.isArray(c.complainedRecipients)
                ? c.complainedRecipients
                      .map((r) => texto(objeto(r).emailAddress))
                      .filter((e): e is string => Boolean(e))
                : []
            return {
                ...base,
                tipo: 'Complaint',
                destinatarios: reclamantes.length ? reclamantes : destinatarios,
                em: new Date(texto(c.timestamp) ?? base.em),
                motivo: texto(c.complaintFeedbackType) ?? 'reclamação de spam',
            }
        }

        case 'Delivery':
            return { ...base, tipo: 'Delivery', em: new Date(texto(objeto(raiz.delivery).timestamp) ?? base.em) }

        case 'Open':
            return { ...base, tipo: 'Open', em: new Date(texto(objeto(raiz.open).timestamp) ?? base.em) }

        case 'Click':
            return { ...base, tipo: 'Click', em: new Date(texto(objeto(raiz.click).timestamp) ?? base.em) }

        case 'Reject':
            return {
                ...base,
                tipo: 'Reject',
                motivo: texto(objeto(raiz.reject).reason) ?? 'recusado pelo SES',
            }

        case 'DeliveryDelay':
            return {
                ...base,
                tipo: 'DeliveryDelay',
                motivo: texto(objeto(raiz.deliveryDelay).delayType) ?? 'atraso na entrega',
            }

        case 'Subscription':
            return { ...base, tipo: 'Subscription' }

        case 'Send':
            return { ...base, tipo: 'Send' }

        case 'RenderingFailure':
            return {
                ...base,
                tipo: 'RenderingFailure',
                motivo: texto(objeto(raiz.failure).errorMessage) ?? 'falha ao montar o e-mail',
            }

        default:
            return null
    }
}

/**
 * O que o evento faz com o destinatário.
 *
 * Separado da gravação porque é a parte que decide, e decidir tem de ser
 * testável sem banco — é a regra da casa para lógica.
 *
 * **O estado não anda para trás.** Um `Delivery` que chegue depois de um `Open`
 * (a ordem dos eventos do SNS não é garantida) não pode rebaixar o destinatário
 * de "aberto" para "entregue". Por isso cada estado tem um peso, e só sobe.
 */
const PESO: Record<string, number> = {
    pending: 0,
    sent: 1,
    delivered: 2,
    read: 3,
    failed: 4,
    skipped: 4,
}

/** O status que o evento quer pôr, ou `null` quando ele não mexe no status. */
export function statusDoEvento(evento: EventoDoSes): string | null {
    switch (evento.tipo) {
        case 'Delivery':
            return 'delivered'
        // Abertura e clique entram como `read` — é o equivalente mais próximo
        // no vocabulário que o WhatsApp já usa nesta tabela, e deixa a tela de
        // detalhe contar os dois canais com os mesmos nomes.
        case 'Open':
        case 'Click':
            return 'read'
        case 'Bounce':
            // Bounce transitório não é falha final: o SES ainda pode entregar.
            return evento.bounceDuro ? 'failed' : null
        case 'Complaint':
        case 'Reject':
        case 'RenderingFailure':
            return 'failed'
        default:
            return null
    }
}

/** `true` quando o status novo é um avanço sobre o que já está gravado. */
export function avanca(atual: string, novo: string): boolean {
    return (PESO[novo] ?? 0) > (PESO[atual] ?? 0)
}

/**
 * `true` quando o evento significa "não mande mais para este endereço".
 *
 * Reclamação de spam e bounce **duro**. Transitório fica de fora de propósito:
 * caixa cheia volta a funcionar, e descadastrar por isso perde o contato para
 * sempre por causa de uma semana de férias.
 */
export function pedeSupressao(evento: EventoDoSes): boolean {
    if (evento.tipo === 'Complaint') return true
    if (evento.tipo === 'Bounce') return evento.bounceDuro === true
    return false
}
