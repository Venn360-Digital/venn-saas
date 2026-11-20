import { msisdnDoJid,
    type ConnectionState,
    type CreatedInstance,
    type DownloadedMedia,
    type InstanceCredentials,
    type PresenceState,
    type QrCode,
    type SendMediaInput,
    type SendResult,
    type ChannelProvider,
    ChannelProviderError,
    normalizeNumber,
    phoneVariants,
    toMsisdn,
} from './types'
import { prefixoDaInstancia } from './instancia'

/**
 * O gateway do canal QR — o service binding para o Worker `odontobox-evolution`.
 *
 * Registrado pela costura (`src/cloudflare/costuras.ts`), e guardado no módulo
 * pelo mesmo motivo das outras: é o próprio binding, que a plataforma troca com
 * o isolate. Nulo fora do Worker (dev local, VPS), onde o cliente cai no
 * `EVOLUTION_GO_URL` por HTTP público.
 */
let gateway: { fetch(req: Request): Promise<Response> } | null = null
export function registrarGatewayEvolutionGo(f: { fetch(req: Request): Promise<Response> }): void {
    gateway = f
}

/**
 * A sala do contêiner = o id da integração, do nome da instância
 * (`odontobox_{id}_{carimbo}`). Mesma convenção do Worker (`roteamento.ts`),
 * duplicada aqui porque o app não importa do projeto da POC. O id é cuid (sem
 * `_`), então fica sempre na segunda parte.
 */
function salaDoNome(instanceName: string): string | null {
    const partes = instanceName.split('_')
    /*
     * O prefixo vem da marca, e hoje é byte a byte o literal que estava aqui.
     *
     * Importa que continue: o nome da instância é **criado na Evolution** e
     * guardado no `config` da linha. Trocar o prefixo faria este reconhecimento
     * falhar para toda linha já conectada — as mensagens chegariam ao Worker e
     * seriam descartadas por "sala desconhecida", sem erro e sem log de causa.
     * `test:instancia` trava a igualdade.
     */
    if (partes.length < 2 || partes[0] !== prefixoDaInstancia()) return null
    const id = partes[1]
    return id && /^[a-z0-9]{20,40}$/i.test(id) ? id : null
}

/**
 * Evolution Go client (whatsmeow).
 *
 * Two things shape this file, both verified against the project's routes.go and
 * auth_middleware.go rather than the docs, which disagree with themselves:
 *
 *   1. Authentication is a single `apikey` header with two meanings. The global
 *      key reaches only the admin routes (`/instance/create`, `/instance/all`,
 *      `/instance/delete/:id`); every other route takes a per-instance token and
 *      resolves the instance from it (`GetInstanceByToken`). There is no instance
 *      in the path, so the token *is* the addressing.
 *   2. Responses are wrapped: `{ data: ..., message: "success" }`.
 */

const DEFAULT_TIMEOUT_MS = 20_000
/**
 * Timeout maior para as chamadas que acordam o contêiner.
 *
 * O arranque a frio do contêiner é de 25-40 s (medido, `containers-cloudflare`),
 * e `create`/`connect`/`qr` são a primeira chamada de uma sala — a que paga esse
 * tempo. Os 20 s do padrão abortavam no cold start (medido 2026-10-22).
 */
const COLD_START_TIMEOUT_MS = 60_000
/** Foto de perfil: curto de propósito — quem não tem foto faz a consulta pendurar. */
const AVATAR_TIMEOUT_MS = 8_000

/** Webhook events we subscribe to. See pkg/events for the full catalogue. */
export const SUBSCRIBED_EVENTS = [
    'MESSAGE',
    'SEND_MESSAGE',
    'READ_RECEIPT',
    'CHAT_PRESENCE',
    'CONNECTION',
    'QRCODE',
    /**
     * A foto do paciente chega por aqui.
     *
     * O Evolution Go já emite `Picture` o tempo todo (visível no log do
     * contêiner); nós é que nunca assinávamos o balde. Não existe `PICTURE` no
     * vocabulário aceito — `CONTACT` é o balde onde ele vem.
     *
     * A assinatura só vale a partir do próximo `/instance/connect`: a instância
     * já pareada continua com a lista antiga até reconectar.
     */
    'CONTACT',
] as const

interface Envelope<T> {
    data?: T
    message?: string
}

interface CreateInstanceData {
    id?: string
    name?: string
    token?: string
    connected?: boolean
}

interface InstanceListItem {
    id?: string
    name?: string
    token?: string
    jid?: string
    connected?: boolean
}

/**
 * A carga de `/instance/qr`.
 *
 * Minúsculas, ao contrário de `/instance/status`, que responde em PascalCase
 * (`Connected`, `LoggedIn`). A inconsistência é do Evolution Go, e foi
 * exatamente o que fez o QR nunca chegar à tela: `data.Qrcode` era sempre
 * `undefined`, a rota devolvia `qrcode: null`, e o modal ficava girando sobre um
 * QR que existia e estava pronto do outro lado.
 *
 * As duas grafias são aceitas aqui para o caso de uma versão futura padronizar.
 */
interface QrData {
    qrcode?: string
    code?: string
    Qrcode?: string
    Code?: string
}

interface StatusData {
    Connected?: boolean
    LoggedIn?: boolean
    Name?: string
}

interface SendData {
    messageId?: string
    success?: boolean
}

interface DownloadMediaData {
    base64?: string
    mimetype?: string
    Base64?: string
    Mimetype?: string
}

export class EvolutionGoProvider implements ChannelProvider {
    readonly name = 'evolution-go' as const

    private readonly baseUrl: string
    private readonly globalApiKey: string

    constructor(options?: { baseUrl?: string; globalApiKey?: string }) {
        this.baseUrl = (options?.baseUrl ?? process.env.EVOLUTION_GO_URL ?? '').replace(/\/$/, '')
        this.globalApiKey = options?.globalApiKey ?? process.env.EVOLUTION_GO_API_KEY ?? ''
    }

    private assertConfigured(): void {
        if (!this.baseUrl) throw new Error('EVOLUTION_GO_URL is not set')
        if (!this.globalApiKey) throw new Error('EVOLUTION_GO_API_KEY is not set')
    }

    /**
     * O service token do Cloudflare Access, quando existe.
     *
     * ## Por que o Access entrou
     *
     * O Tunnel resolve **como** o tráfego chega: a origem não tem porta aberta,
     * e o Evolution liga em `127.0.0.1:8080` dentro do host
     * (`infra/compose.evolution-vps.yaml`). O que ele **não** resolve é *quem*
     * pode chegar — o hostname publicado responde a qualquer um na internet.
     *
     * Medido na auditoria de 2026-10-23: `evo-odontobox.venn360.com` expunha a
     * API e o manager inteiros do Evolution Go, com a tela de login pública, e
     * a única defesa era a `apikey` global. Quem a obtivesse enviava e lia
     * WhatsApp como a clínica, listava e apagava instâncias, e alcançava o
     * material de sessão do whatsmeow. Sem Access, sem rate limit de borda,
     * sem mTLS.
     *
     * A política no Access é **Service Auth** — não há caminho de navegador,
     * porque o único cliente deste hostname é este Worker. O André administra
     * o Evolution por túnel SSH para `localhost:8080`, que não passa por aqui.
     *
     * ## Devolve `{}` quando não há token, e isso é deliberado
     *
     * Os cabeçalhos são inofensivos quando o Access ainda não está impondo, e
     * **necessários** depois que estiver. Essa assimetria é o que torna a ordem
     * da implantação segura:
     *
     *   1. criar o service token no painel;
     *   2. gravar os dois segredos no Worker;
     *   3. publicar este código;
     *   4. **só então** criar a aplicação do Access.
     *
     * Inverter 3 e 4 derruba a linha de WhatsApp: a Cloudflare passa a devolver
     * 403 para um Worker que ainda não manda credencial. Falhar aberto aqui não
     * é frouxidão — é o que permite publicar antes de trancar. Depois de
     * trancado, a ausência do segredo aparece como 403 em toda chamada, que é
     * alto e imediato.
     */
    private cabecalhosDoAccess(): Record<string, string> {
        const id = process.env.CF_ACCESS_CLIENT_ID
        const segredo = process.env.CF_ACCESS_CLIENT_SECRET
        if (!id || !segredo) return {}
        return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': segredo }
    }

    /**
     * @param apiKey the global key for admin routes, or the instance token.
     */
    private async request<T>(
        endpoint: string,
        sala: string,
        apiKey: string,
        init: RequestInit = {},
        timeoutMs = DEFAULT_TIMEOUT_MS
    ): Promise<T> {
        if (!apiKey) {
            throw new Error(`Missing apikey for ${endpoint}`)
        }

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            apikey: apiKey,
            ...(init.headers as Record<string, string> | undefined),
        }

        try {
            let response: Response
            if (gateway) {
                // Pelo service binding: `x-evo-gateway` prova que a chamada é do
                // app (defesa em profundidade), `x-evo-sala` roteia ao contêiner.
                // O host da URL é fictício — o binding ignora o host.
                if (!this.globalApiKey) throw new Error('EVOLUTION_GO_API_KEY is not set')
                headers['x-evo-gateway'] = this.globalApiKey
                headers['x-evo-sala'] = sala
                response = await gateway.fetch(
                    new Request(`http://evo${endpoint}`, { ...init, headers, signal: controller.signal })
                )
            } else {
                this.assertConfigured()
                // Os cabeçalhos do Access entram só aqui: o caminho do service
                // binding acima não cruza a borda da Cloudflare, então não há
                // política para satisfazer nele.
                response = await fetch(`${this.baseUrl}${endpoint}`, {
                    ...init,
                    headers: { ...headers, ...this.cabecalhosDoAccess() },
                    signal: controller.signal,
                })
            }

            if (!response.ok) {
                throw new ChannelProviderError(
                    this.name,
                    response.status,
                    await response.text().catch(() => ''),
                    endpoint
                )
            }

            // 204 and empty bodies are legitimate for disconnect/logout.
            const text = await response.text()
            if (!text) return undefined as T

            const parsed = JSON.parse(text) as Envelope<T>
            return (parsed.data ?? (parsed as unknown)) as T
        } finally {
            clearTimeout(timeout)
        }
    }

    /** Instance token, which doubles as the instance selector. */
    private tokenOf(credentials: InstanceCredentials, endpoint: string): string {
        if (!credentials.token) {
            throw new Error(
                `Integration "${credentials.instanceName}" has no Evolution Go token; ` +
                `it cannot address ${endpoint}. Reconnect the instance to obtain one.`
            )
        }
        return credentials.token
    }

    /** A sala (contêiner) desta linha: o id da integração, do instanceName. */
    private salaDe(credentials: InstanceCredentials): string {
        const sala = credentials.instanceName ? salaDoNome(credentials.instanceName) : null
        if (!sala) {
            throw new Error(`instanceName "${credentials.instanceName}" sem sala (id de integração)`)
        }
        return sala
    }

    async createInstance(instanceName: string): Promise<CreatedInstance> {
        const sala = salaDoNome(instanceName)
        if (!sala) throw new Error(`instanceName "${instanceName}" sem sala (id de integração)`)

        // We generate the token rather than letting the server assign one, so the
        // value is known even if the response shape changes — losing it would
        // orphan the instance, since it is the only way to address it.
        const token = crypto.randomUUID()

        const data = await this.request<CreateInstanceData>(
            '/instance/create',
            sala,
            this.globalApiKey,
            { method: 'POST', body: JSON.stringify({ name: instanceName, token }) },
            COLD_START_TIMEOUT_MS
        )

        return {
            instanceName: data?.name ?? instanceName,
            instanceId: data?.id,
            token: data?.token ?? token,
            qrcode: null,
        }
    }

    /**
     * Start the WhatsApp socket and register the webhook.
     *
     * `immediate: true` returns without waiting for the QR to be scanned, which is
     * what the UI needs — it polls `getQrCode` straight after.
     */
    async connect(credentials: InstanceCredentials, webhookUrl: string): Promise<void> {
        await this.request<unknown>(
            '/instance/connect',
            this.salaDe(credentials),
            this.tokenOf(credentials, '/instance/connect'),
            {
                method: 'POST',
                body: JSON.stringify({
                    immediate: true,
                    webhookUrl,
                    subscribe: [...SUBSCRIBED_EVENTS],
                }),
            },
            COLD_START_TIMEOUT_MS
        )
    }

    async getQrCode(credentials: InstanceCredentials): Promise<QrCode> {
        const data = await this.request<QrData>(
            '/instance/qr',
            this.salaDe(credentials),
            this.tokenOf(credentials, '/instance/qr'),
            {},
            COLD_START_TIMEOUT_MS
        )
        return {
            base64: asDataUrl(data?.qrcode ?? data?.Qrcode),
            code: data?.code ?? data?.Code ?? null,
        }
    }

    async getConnectionState(credentials: InstanceCredentials): Promise<ConnectionState> {
        const data = await this.request<StatusData>(
            '/instance/status',
            this.salaDe(credentials),
            this.tokenOf(credentials, '/instance/status')
        )

        const socketOpen = Boolean(data?.Connected)
        const loggedIn = Boolean(data?.LoggedIn)

        // `Connected` é o websocket com o WhatsApp, e ele abre no instante do
        // `/instance/connect` — ficando aberto durante os minutos em que o QR
        // espera ser lido. Tratá-lo como "conectado" fazia a rota anunciar um
        // número pareado antes de alguém ter escaneado qualquer coisa, e pular
        // a exibição do QR por inteiro.
        //
        // Medido nesta instalação, numa instância descartável:
        //   recém-criada          → {Connected: false, LoggedIn: false}
        //   após connect, sem par → {Connected: true,  LoggedIn: false}
        //
        // `LoggedIn` é o único campo que distingue os dois casos.
        const state: ConnectionState = {
            connected: loggedIn,
            loggedIn,
            socketOpen,
        }

        // /instance/status reports no number, so fall back to the admin listing,
        // whose entries carry the owner JID.
        if (state.connected && !credentials.phoneNumber) {
            const owner = await this.getOwnerJid(credentials)
            if (owner) state.phoneNumber = toMsisdn(owner)
        }

        return state
    }

    /**
     * Recover an existing instance by name, token included.
     *
     * Needed when `/instance/create` reports the name is taken but we have no
     * token stored: without the token the instance is unaddressable, and
     * `/instance/all` is the only place it is exposed.
     */
    async findInstanceByName(instanceName: string): Promise<InstanceCredentials | null> {
        const sala = salaDoNome(instanceName)
        if (!sala) return null
        const instances = await this.request<InstanceListItem[]>('/instance/all', sala, this.globalApiKey)
        const match = instances?.find((i) => i.name === instanceName)
        if (!match?.token) return null

        return {
            instanceName: match.name ?? instanceName,
            instanceId: match.id,
            token: match.token,
            phoneNumber: match.jid ? toMsisdn(match.jid) : undefined,
        }
    }

    async getOwnerJid(credentials: InstanceCredentials): Promise<string | undefined> {
        try {
            const instances = await this.request<InstanceListItem[]>(
                '/instance/all',
                this.salaDe(credentials),
                this.globalApiKey
            )
            const match = instances?.find(
                (i) => i.id === credentials.instanceId || i.name === credentials.instanceName
            )
            return match?.jid
        } catch {
            // Non-fatal: the connection state itself is already known.
            return undefined
        }
    }

    /**
     * POST /instance/disconnect — closes the websocket, keeps the device store.
     * Answered 200 on this deployment; the session survives a reconnect by JID.
     */
    async disconnect(credentials: InstanceCredentials): Promise<void> {
        await this.request<unknown>('/instance/disconnect', this.salaDe(credentials), this.tokenOf(credentials, '/instance/disconnect'), {
            method: 'POST',
            body: JSON.stringify({}),
        })
    }

    async deleteInstance(credentials: InstanceCredentials): Promise<void> {
        if (!credentials.instanceId) {
            // Deletion is addressed by id, so resolve it from the listing first.
            const instances = await this.request<InstanceListItem[]>(
                '/instance/all',
                this.salaDe(credentials),
                this.globalApiKey
            )
            const match = instances?.find((i) => i.name === credentials.instanceName)
            if (!match?.id) return
            await this.request<unknown>(`/instance/delete/${match.id}`, this.salaDe(credentials), this.globalApiKey, {
                method: 'DELETE',
            })
            return
        }

        await this.request<unknown>(
            `/instance/delete/${credentials.instanceId}`,
            this.salaDe(credentials),
            this.globalApiKey,
            { method: 'DELETE' }
        )
    }

    /**
     * `POST /user/check` — o IsOnWhatsApp do whatsmeow, por trás do Evolution Go.
     *
     * A resposta é `gin.H` sem contrato, então a leitura é defensiva de
     * propósito. Medido contra a instância em produção:
     *
     * - inexistente: `{"data":{"Users":null}}`;
     * - existente: `{"data":{"Users":[{"Query":"+553188501161",
     *   "IsInWhatsapp":true,"JID":"553188501161@s.whatsapp.net",...}]}}`.
     *
     * Duas armadilhas reais nesse retorno. O booleano se chama `IsInWhatsapp`,
     * e nomes alternativos são aceitos porque a versão pode mudar — só um
     * `false` explícito conta como "não tem". E **o número volta diferente do
     * que foi perguntado**: `5531988501161` responde como `553188501161`, sem o
     * nono dígito, porque é assim que a conta está registrada. Por isso o
     * casamento é por variante, e o JID é devolvido ao chamador: é ele a forma
     * pela qual a mensagem vai chegar, e portanto a forma que deve ser gravada.
     *
     * Falha de rede ou instância desconectada devolve `undefined`, não `false`:
     * bloquear o cadastro por uma verificação instável é pior que aceitar um
     * número que talvez erre.
     */
    /**
     * `POST /user/avatar` — a foto de perfil, quando o paciente deixa ver.
     *
     * Três cuidados, todos medidos contra a instância de produção:
     *
     * 1. **Timeout curto.** Esta chamada já respondeu 500 depois de ~75s com
     *    `GetProfilePictureInfo failed: info query timed out`. Quem não tem foto
     *    pública faz a consulta pendurar em vez de responder "não tem", então
     *    oito segundos é o limite entre tentar e atrapalhar.
     * 2. **Leitura tolerante.** O Swagger tipa o 200 só como `gin.H`, sem nomes
     *    de campo. Em vez de apostar num, procura-se a primeira string que
     *    pareça URL — e `undefined` quando não houver.
     * 3. **Nunca lança.** Foto é enfeite: a ficha com as iniciais está correta,
     *    e derrubar o processamento de uma mensagem por causa dela não é troca
     *    aceitável.
     */
    async getProfilePictureUrl(
        credentials: InstanceCredentials,
        number: string
    ): Promise<string | undefined> {
        const wanted = normalizeNumber(number)
        if (!wanted) return undefined

        try {
            const payload = await this.request<Record<string, unknown> | undefined>(
                '/user/avatar',
                this.salaDe(credentials),
                this.tokenOf(credentials, '/user/avatar'),
                { method: 'POST', body: JSON.stringify({ number: wanted, preview: false }) },
                AVATAR_TIMEOUT_MS
            )

            const container =
                (payload && typeof payload.data === 'object' && payload.data !== null
                    ? (payload.data as Record<string, unknown>)
                    : payload) ?? {}

            for (const value of Object.values(container)) {
                if (typeof value === 'string' && /^https?:\/\//.test(value)) return value
            }
            return undefined
        } catch {
            return undefined
        }
    }

    async checkNumbers(
        credentials: InstanceCredentials,
        numbers: string[]
    ): Promise<{ number: string; exists: boolean | undefined; jid?: string }[]> {
        const wanted = numbers.map(normalizeNumber).filter(Boolean)
        if (wanted.length === 0) return []

        let users: Record<string, unknown>[] = []
        try {
            const payload = await this.request<Record<string, unknown> | undefined>(
                '/user/check',
                this.salaDe(credentials),
                this.tokenOf(credentials, '/user/check'),
                { method: 'POST', body: JSON.stringify({ number: wanted, formatJid: true }) }
            )

            // `request` devolve o envelope já desembrulhado (`parsed.data`), como
            // todos os outros métodos deste arquivo consomem. A primeira versão
            // desta função procurava `data.data.Users` — o corpo cru — e nunca
            // achava nada. As duas formas são aceitas aqui para que a função não
            // dependa de qual camada desembrulha.
            const container =
                (payload && typeof payload.data === 'object' && payload.data !== null
                    ? (payload.data as Record<string, unknown>)
                    : payload) ?? {}

            const key = Object.keys(container).find((k) => k.toLowerCase() === 'users')
            if (!key) {
                // Forma desconhecida é "não sei", nunca "não tem". Confundir os
                // dois foi o que fez a tela afirmar que um número com WhatsApp
                // não tinha — uma falsidade confiante é pior que um aviso.
                return wanted.map((number) => ({ number, exists: undefined }))
            }

            const raw = container[key]
            if (raw === null || raw === undefined) {
                // Resposta válida dizendo "nenhum destes existe".
                return wanted.map((number) => ({ number, exists: false }))
            }
            users = (Array.isArray(raw) ? raw : [raw]) as Record<string, unknown>[]
        } catch {
            return wanted.map((number) => ({ number, exists: undefined }))
        }

        return wanted.map((number) => {
            const asked = new Set(phoneVariants(number))
            const hit = users.find((u) => {
                const query = normalizeNumber(String(u.Query ?? u.query ?? ''))
                /**
                 * Só JID de **telefone** casa por número. Um LID nunca bate com
                 * o que foi perguntado — e se batesse por acaso, casaria a
                 * pessoa errada.
                 */
                const jid = msisdnDoJid(String(u.JID ?? u.jid ?? ''))
                return (
                    phoneVariants(query).some((v) => asked.has(v)) ||
                    (jid !== null && phoneVariants(jid).some((v) => asked.has(v)))
                )
            })
            if (!hit) return { number, exists: false }

            const flag = hit.IsInWhatsapp ?? hit.isInWhatsapp ?? hit.IsIn ?? hit.isIn ?? hit.exists
            const jid = hit.JID ?? hit.jid
            return {
                number,
                exists: flag === false ? false : true,
                jid: typeof jid === 'string' ? jid : undefined,
            }
        })
    }

    async sendText(
        credentials: InstanceCredentials,
        to: string,
        text: string
    ): Promise<SendResult> {
        const data = await this.request<SendData>('/send/text', this.salaDe(credentials), this.tokenOf(credentials, '/send/text'), {
            method: 'POST',
            body: JSON.stringify({ number: normalizeNumber(to), text }),
        })

        return { externalId: data?.messageId }
    }

    async sendMedia(
        credentials: InstanceCredentials,
        to: string,
        input: SendMediaInput
    ): Promise<SendResult> {
        const data = await this.request<SendData>('/send/media', this.salaDe(credentials), this.tokenOf(credentials, '/send/media'), {
            method: 'POST',
            body: JSON.stringify({
                number: normalizeNumber(to),
                url: input.url,
                type: input.kind,
                caption: input.caption,
                filename: input.fileName,
            }),
        })

        return { externalId: data?.messageId }
    }

    /**
     * POST /message/react — fields measured on this deployment: number, id, reaction.
     * An empty reaction removes a previous one.
     */
    async react(credentials: InstanceCredentials, to: string, messageId: string, emoji: string): Promise<void> {
        await this.request<unknown>('/message/react', this.salaDe(credentials), this.tokenOf(credentials, '/message/react'), {
            method: 'POST',
            body: JSON.stringify({ number: normalizeNumber(to), id: messageId, reaction: emoji }),
        })
    }

    /**
     * POST /message/delete — apaga para todos.
     *
     * **O corpo é `{ chat, messageId }`**, e os dois nomes importam: conferido
     * no fonte da 0.7.2 (`pkg/message/service/message_service.go`,
     * `type MessageStruct`), que é a versão exata da nossa imagem. O handler
     * recusa com 400 se `chat` ou `messageId` faltarem.
     *
     * Note que **não é `number` nem `id`**, como em `/message/react` — as rotas
     * deste servidor não têm vocabulário único. A rota passa por um middleware
     * que normaliza `number`, mas ele só age se o campo existir, então mandar
     * `chat` sozinho está correto.
     */
    async revoke(credentials: InstanceCredentials, to: string, messageId: string): Promise<void> {
        await this.request<unknown>('/message/delete', this.salaDe(credentials), this.tokenOf(credentials, '/message/delete'), {
            method: 'POST',
            body: JSON.stringify({ chat: normalizeNumber(to), messageId }),
        })
    }

    /**
     * POST /message/edit — troca o texto de uma mensagem enviada.
     *
     * Corpo `{ chat, message, messageId }`, de `type EditMessageStruct` no mesmo
     * arquivo do fonte. Só texto: o `routes.go` da 0.7.2 traz
     * `// TODO: edit MediaMessage too` ao lado desta rota.
     */
    async editText(
        credentials: InstanceCredentials,
        to: string,
        messageId: string,
        texto: string
    ): Promise<void> {
        await this.request<unknown>('/message/edit', this.salaDe(credentials), this.tokenOf(credentials, '/message/edit'), {
            method: 'POST',
            body: JSON.stringify({ chat: normalizeNumber(to), message: texto, messageId }),
        })
    }

    /**
     * POST /message/markread — confirma leitura (checks azuis).
     *
     * `id` é **array** de propósito: medido em 2026-10-22, o struct recusa string
     * (`cannot unmarshal string into []string`). Marcar a última recebida já
     * cobre as anteriores do mesmo chat. Resolve o "um check só" quando o aparelho
     * primário da clínica está desligado — ver `ChannelProvider.markRead`.
     */
    async markRead(credentials: InstanceCredentials, to: string, messageIds: string[]): Promise<void> {
        if (messageIds.length === 0) return
        await this.request<unknown>('/message/markread', this.salaDe(credentials), this.tokenOf(credentials, '/message/markread'), {
            method: 'POST',
            body: JSON.stringify({ number: normalizeNumber(to), id: messageIds }),
        })
    }

    async sendPresence(
        credentials: InstanceCredentials,
        to: string,
        presence: PresenceState
    ): Promise<void> {
        await this.request<unknown>('/message/presence', this.salaDe(credentials), this.tokenOf(credentials, '/message/presence'), {
            method: 'POST',
            // O campo é `state`, não `presence`. Medido contra a instância:
            // com `presence` a resposta é 400 "state is required", e o
            // indicador de digitando nunca chegava ao paciente.
            body: JSON.stringify({ number: normalizeNumber(to), state: presence }),
        })
    }

    /**
     * Fetch media bytes for a received message.
     *
     * Rarely used: with `WEBHOOKFILES=true` the base64 already arrives on the
     * event. This is the fallback for a MinIO-backed deployment or a truncated
     * payload.
     */
    async downloadMedia(
        credentials: InstanceCredentials,
        raw: Record<string, unknown>
    ): Promise<DownloadedMedia | null> {
        const data = await this.request<DownloadMediaData>(
            '/message/downloadmedia',
            this.salaDe(credentials),
            this.tokenOf(credentials, '/message/downloadmedia'),
            { method: 'POST', body: JSON.stringify(raw) }
        )

        const base64 = data?.base64 ?? data?.Base64
        const mimetype = data?.mimetype ?? data?.Mimetype

        if (!base64) return null
        // Sem invenção: `/message/downloadmedia` às vezes não informa o tipo, e
        // dizer `octet-stream` por ele impedia o chamador de usar o tipo do
        // envelope. Ver `DownloadedMedia.mimetype`.
        return { base64, mimetype }
    }

    /**
     * Sonda de vida. **Não é mais anônima**: `/server/ok` não pede `apikey` no
     * Evolution, mas o hostname fica atrás do Access, então sem o service token
     * a resposta é 403 da Cloudflare — e um health check que devolve `false`
     * por falta de credencial diria "o Evolution caiu" sobre um Evolution no ar.
     */
    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/server/ok`, {
                headers: this.cabecalhosDoAccess(),
            })
            return response.ok
        } catch {
            return false
        }
    }
}

/**
 * Normalise a QR payload to a data URL.
 *
 * Evolution Go returns bare base64 where Evolution v2 returned a full data URL,
 * and `next/image` renders only the latter — so the prefix is added here rather
 * than leaving every consumer to guess.
 */
function asDataUrl(value: string | undefined): string | null {
    if (!value) return null
    if (value.startsWith('data:')) return value
    return `data:image/png;base64,${value}`
}

export const evolutionGo = new EvolutionGoProvider()
