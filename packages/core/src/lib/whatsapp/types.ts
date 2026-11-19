/**
 * Provider-agnostic WhatsApp contract.
 *
 * Two implementations sit behind it:
 *   - `evolution-go`  — Evolution Go (whatsmeow). Powers the QR channel.
 *   - `meta-whatsapp` — Meta Cloud API, falando DIRETO com a Graph API, sem
 *                       contêiner. Serve o canal oficial (whatsapp_business).
 *
 * Eles diferem mais que uma URL: o Evolution Go tem socket e instância; o
 * meta-whatsapp não tem nenhum dos dois (a Meta hospeda tudo) e o inbound chega
 * por webhook da própria Meta. Tudo que é específico de provedor fica nas
 * implementações; quem chama só vê esta interface.
 */

export type ChannelProviderName = 'evolution-go' | 'meta-whatsapp' | 'meta-instagram'

/** `AgentIntegration.channel` values that carry WhatsApp. */
export type WhatsAppChannel = 'whatsapp_qr' | 'whatsapp_business'

/** Todo canal de mensagem que tem provedor — WhatsApp e Instagram. */
export type MessagingChannel = WhatsAppChannel | 'instagram'

/**
 * Os canais de WhatsApp, e só eles.
 *
 * Separado de `CHANNEL_PROVIDER` porque várias regras são de WhatsApp e não de
 * canal: a vaga do plano é contada em números, o cron de saúde reconecta sessão
 * (o Instagram não tem sessão para cair) e a linha da conversa se resolve entre
 * números da clínica. Misturar o Instagram nessas três faria o cron tentar
 * reconectar uma conta que nunca esteve fora do ar.
 */
export const WHATSAPP_PROVIDER: Record<WhatsAppChannel, ChannelProviderName> = {
    whatsapp_qr: 'evolution-go',
    whatsapp_business: 'meta-whatsapp',
}

/**
 * Which implementation serves which channel.
 *
 * O canal QR é Evolution Go (whatsmeow); o oficial (whatsapp_business) fala
 * direto com a Graph API da Meta. O Evolution API v2 foi aposentado — ele era
 * um contêiner que só reescrevia JSON entre nós e a mesma Graph.
 *
 * O Instagram vai **direto à Meta**, sem intermediário: o Evolution não tem
 * canal de Instagram (medido em 2026-10-16: `grep -ri instagram` no repositório
 * dele não devolve nada), e não teria o que fazer ali — ele existe para
 * contornar a API oficial do WhatsApp, e a de Instagram é aberta e gratuita.
 */
export const CHANNEL_PROVIDER: Record<MessagingChannel, ChannelProviderName> = {
    ...WHATSAPP_PROVIDER,
    instagram: 'meta-instagram',
}

/**
 * What we persist in `AgentIntegration.config` to talk to one instance.
 *
 * `token` is load-bearing for Evolution Go: it is both the credential and the
 * instance selector, because the send endpoints take no instance parameter.
 */
export interface InstanceCredentials {
    /** Per-instance token. Required by evolution-go; unused by evolution-v2. */
    token?: string
    /** Provider-side instance id. Evolution Go webhooks identify by this. */
    instanceId?: string
    /**
     * Como o provedor chama esta linha. evolution-v2 a põe no caminho da URL.
     *
     * No Instagram não há instância para nomear — quem identifica a linha é a
     * própria conta, e é o id dela que fica aqui. O campo continua querendo
     * dizer a mesma coisa (o identificador da linha no provedor), e é isso que
     * aparece no log quando algo dá errado.
     */
    instanceName: string
    /** Cached owner MSISDN, once known. */
    phoneNumber?: string
    /** Presente só nas linhas de Instagram. Ver `InstagramCredentials`. */
    instagram?: InstagramCredentials
    /** Presente só no canal oficial (whatsapp_business). Ver `BusinessCredentials`. */
    business?: BusinessCredentials
}

/**
 * Credenciais da Meta para uma linha oficial (Cloud API).
 *
 * Coletadas por integração no onboarding (`src/lib/meta/onboarding.ts`) e
 * guardadas em `AgentIntegration.config.business`. Era definido em
 * `evolution-v2.ts`; mudou de casa quando o v2 foi aposentado, porque quem as
 * usa agora é o `meta-whatsapp`.
 */
export interface BusinessCredentials {
    /** Token de acesso da Meta (alongado no onboarding). */
    accessToken: string
    /** O id do número no app da Meta, não o número discável. */
    phoneNumberId: string
    /** O id da conta de negócio do WhatsApp (WABA). */
    businessId: string
}

/**
 * O que guardamos para falar por uma conta de Instagram.
 *
 * Uma conta só: ela é quem recebe (é o `entry[].id` de todo evento do webhook)
 * e por quem se envia (`POST /{IG_ID}/messages` em `graph.instagram.com`).
 */
export interface InstagramCredentials {
    /** A conta profissional. É por ela que o evento acha o workspace. */
    igAccountId: string
    /**
     * Token da conta, pela rota de login do próprio Instagram.
     *
     * **Dura 60 dias** e é renovado pelo cron `instagram-token-refresh`. A
     * alternativa — token de Página, que não expira — exigia da clínica Página
     * do Facebook e portfólio empresarial, e consultório pequeno tem só o
     * Instagram. Trocamos um custo do cliente por um custo nosso.
     */
    accessToken: string
    /**
     * Quando o token vence, em ISO. É o que o cron lê para renovar a tempo.
     *
     * Ausente nas linhas criadas pela rota antiga, que não tinham prazo.
     */
    expiresAt?: string
    /**
     * A Página do Facebook, só nas linhas da rota antiga.
     *
     * Não existe mais no fluxo de hoje: a conexão pelo login do Instagram não
     * passa por Página nenhuma.
     */
    pageId?: string
    /** O @ da conta, para a tela dizer qual Instagram está no ar. */
    username?: string
}

export interface CreatedInstance extends InstanceCredentials {
    /** Data URL or raw base64 of the pairing QR, when the provider returns one. */
    qrcode?: string | null
}

export interface ConnectionState {
    /**
     * Há uma sessão de WhatsApp pareada. É o que "conectado" significa para
     * quem pergunta — a tela, o cron de saúde e o envio de mensagem.
     */
    connected: boolean
    loggedIn?: boolean
    /**
     * O socket com o WhatsApp está aberto. Abre no `/instance/connect` e fica
     * aberto durante todo o tempo em que o QR espera ser lido, então sozinho
     * ele não diz nada sobre pareamento. Diagnóstico apenas.
     */
    socketOpen?: boolean
    /** Owner MSISDN when the provider exposes it. */
    phoneNumber?: string
}

export interface QrCode {
    base64?: string | null
    code?: string | null
}

export interface SendResult {
    /** Provider's message id, stored as `Message.externalId` for receipt tracking. */
    externalId?: string
}

export type MediaKind = 'image' | 'video' | 'audio' | 'document'

/**
 * Um template (HSM) pronto para disparo, no formato que a Graph aceita.
 *
 * `components` é opcional: um template sem variável não leva nenhum. Quando leva,
 * é a lista `{ type: 'body'|'header'|'button', parameters: [...] }` que a Meta
 * espera — montada por quem dispara, a partir do template guardado e das
 * variáveis da campanha. Só o canal oficial entende template; o QR não.
 */
export interface SendTemplateInput {
    /** Nome do template aprovado na Meta. */
    name: string
    /** Código de idioma (ex.: "pt_BR"). */
    language: string
    components?: Record<string, unknown>[]
}

export interface SendMediaInput {
    /** Publicly reachable URL. Both providers fetch the bytes themselves. */
    url: string
    kind: MediaKind
    caption?: string
    fileName?: string
    mimetype?: string
}

export type PresenceState = 'composing' | 'paused' | 'recording'

/**
 * O que um envio precisa dizer sobre si além do conteúdo.
 *
 * Existe por causa do Instagram, onde a Meta impõe uma **janela de 24 horas**
 * contada da última mensagem do paciente. Dentro dela qualquer um escreve; fora
 * dela só uma pessoa, e o envio tem de ir marcado como tal — é o que estende o
 * prazo para 7 dias. Marcar uma resposta automática assim é uso indevido da
 * etiqueta e caminho conhecido para perder o acesso à API, então quem decide
 * isto é o worker, pelo autor da mensagem, e não quem escreve a chamada.
 *
 * Os dois provedores de WhatsApp ignoram: lá a janela não existe desta forma.
 */
export interface SendOptions {
    /** O envio é de um atendente humano, fora da janela de 24 horas. */
    humanAgent?: boolean
}

export interface DownloadedMedia {
    base64: string
    /**
     * **Opcional de propósito, e isto consertou um defeito.**
     *
     * Era `string`, e cada provedor preenchia um `'application/octet-stream'`
     * inventado quando não sabia o tipo. O efeito foi apagar a diferença entre
     * "é octet-stream" e "não sei": o `?? input.mimetype` de
     * `obterBytesDaMidia`, que existe justamente para cair no tipo que veio no
     * envelope do webhook, **nunca disparava** — o lado esquerdo nunca era nulo.
     *
     * Com isso toda mídia baixada pelo fallback perdia o tipo, e a nota de voz
     * ia para a transcrição como `application/octet-stream` com o nome
     * `nota.ogg`: um palpite, e errado para áudio de iPhone (`audio/mp4`). A
     * OpenAI recusava com 400 em ~500 ms e o paciente ouvia que o agente não
     * conseguiu entender o áudio. Ver `transcribe.ts`.
     *
     * Quem não sabe devolve `undefined` e deixa o chamador decidir.
     */
    mimetype?: string
}

export interface ChannelProvider {
    readonly name: ChannelProviderName

    /**
     * Provision an instance. For `evolution-go` this is an admin-key call that
     * returns the per-instance token the caller must persist.
     */
    createInstance(instanceName: string): Promise<CreatedInstance>

    /**
     * Start the WhatsApp connection and point it at our webhook.
     *
     * Separate from `createInstance` because Evolution Go splits them: creation is
     * an admin operation, connecting is per-instance and carries the webhook URL
     * and event subscription.
     */
    connect(credentials: InstanceCredentials, webhookUrl: string): Promise<void>

    getQrCode(credentials: InstanceCredentials): Promise<QrCode>

    getConnectionState(credentials: InstanceCredentials): Promise<ConnectionState>

    deleteInstance(credentials: InstanceCredentials): Promise<void>

    /**
     * Close the provider's socket for this instance without unpairing it.
     * Optional: only Evolution Go exposes it, and only Evolution Go needs it.
     */
    disconnect?(credentials: InstanceCredentials): Promise<void>

    /**
     * The paired device's JID, if the instance has ever paired. Optional.
     *
     * This — not `loggedIn` — is the signal that a reconnect is safe: right after
     * PairSuccess the socket sits in a reconnect window where `LoggedIn` stays
     * false for minutes, while the JID is already stored.
     */
    getOwnerJid?(credentials: InstanceCredentials): Promise<string | undefined>

    /** React to a message the contact sent (by its provider message id). Optional. */
    react?(credentials: InstanceCredentials, to: string, messageId: string, emoji: string): Promise<void>

    /**
     * Whether each number has WhatsApp. Optional — only the QR provider has it.
     *
     * Serve ao cadastro ativo: sem isso, um dígito trocado cria paciente,
     * negócio e cartão no funil para um número que nunca vai receber mensagem.
     * `undefined` num item significa "não deu para verificar", que é diferente
     * de "não tem" — a tela trata os dois casos de forma diferente.
     */
    checkNumbers?(
        credentials: InstanceCredentials,
        numbers: string[]
    ): Promise<{ number: string; exists: boolean | undefined; jid?: string }[]>

    /**
     * A URL da foto de perfil do número, quando ela é pública. Opcional.
     *
     * `undefined` cobre os três casos que não se distinguem de fora: não tem
     * foto, não deixa ver, e a consulta não respondeu. Nenhum deles é erro —
     * a ficha sem foto mostra as iniciais e está certa.
     */
    getProfilePictureUrl?(credentials: InstanceCredentials, number: string): Promise<string | undefined>

    /**
     * Quem é o contato, pelo id dele no canal. Opcional.
     *
     * Existe porque o webhook do Instagram **não manda o nome de quem
     * escreveu** — só o IGSID. Sem esta consulta, a ficha nasceria chamada
     * "Instagram 17841…" e ficaria assim para sempre, e a caixa de entrada
     * ficaria cheia de números que ninguém reconhece. O WhatsApp não precisa:
     * lá o nome de exibição vem no próprio evento.
     *
     * Nulo é resposta legítima: perfil que não deixa ver, ou consulta que não
     * respondeu. A ficha sem nome mostra o id e está correta.
     */
    getContactProfile?(
        credentials: InstanceCredentials,
        externalId: string
    ): Promise<{ name?: string; profilePicUrl?: string } | null>

    sendText(
        credentials: InstanceCredentials,
        to: string,
        text: string,
        options?: SendOptions
    ): Promise<SendResult>

    sendMedia(
        credentials: InstanceCredentials,
        to: string,
        input: SendMediaInput,
        options?: SendOptions
    ): Promise<SendResult>

    /**
     * Envia um template (HSM) aprovado. Opcional: só o canal oficial da Meta o
     * implementa — é o único caminho de disparo frio fora da janela de 24h, e é
     * o que o Broadcast usa. O QR não tem template e deixa este método ausente.
     */
    sendTemplate?(
        credentials: InstanceCredentials,
        to: string,
        template: SendTemplateInput
    ): Promise<SendResult>

    sendPresence(
        credentials: InstanceCredentials,
        to: string,
        presence: PresenceState
    ): Promise<void>

    /**
     * Fetch the bytes of a received media message.
     *
     * Only needed when the provider did not inline them in the webhook; Evolution
     * Go with `WEBHOOKFILES=true` already does, which is the configuration we run.
     */
    downloadMedia(
        credentials: InstanceCredentials,
        raw: Record<string, unknown>
    ): Promise<DownloadedMedia | null>

    /**
     * Confirma leitura das mensagens recebidas (os checks azuis).
     *
     * Opcional, porque nem todo provedor precisa: o Cloud API da Meta hospeda a
     * sessão e já confirma a entrega sozinho. O Evolution Go/whatsmeow, não —
     * medido em 2026-10-22, com o aparelho primário da clínica desligado o
     * recibo de entrega automático **não dispara**, e o paciente vê um check só,
     * como se a clínica não tivesse recebido (mesmo já estando no app). Chamado
     * quando o agente abre e lê a conversa, então o check reflete a verdade.
     */
    markRead?(
        credentials: InstanceCredentials,
        to: string,
        messageIds: string[]
    ): Promise<void>
}

/** Thrown for a non-2xx provider response, so callers can read the status. */
export class ChannelProviderError extends Error {
    constructor(
        readonly provider: ChannelProviderName,
        readonly status: number,
        readonly body: string,
        endpoint: string
    ) {
        super(`${provider} ${status} on ${endpoint}: ${body.slice(0, 300)}`)
        this.name = 'ChannelProviderError'
    }

    /** The provider already has an instance under this name. */
    get isConflict(): boolean {
        return this.status === 403 || this.status === 409 || /already in use/i.test(this.body)
    }

    get isNotFound(): boolean {
        return this.status === 404
    }
}

/** Strip the WhatsApp JID suffix down to a bare MSISDN. */
export function toMsisdn(jid: string): string {
    // whatsmeow JIDs can carry a device suffix: "5511999999999:38@s.whatsapp.net"
    return jid.replace(/@.*$/, '').split(':')[0]
}

/**
 * O servidor do JID — o que vem depois do `@`.
 *
 * `s.whatsapp.net` e `c.us` são telefone. `lid` **não é**, e é essa distinção
 * que importa aqui. Os outros (`g.us`, `broadcast`, `newsletter`) nunca foram
 * telefone e entram pela mesma porta.
 */
function servidorDoJid(jid: string): string {
    const corte = jid.indexOf('@')
    return corte < 0 ? '' : jid.slice(corte + 1).toLowerCase()
}

/**
 * O telefone de um JID — **nulo quando o JID não é um telefone**.
 *
 * ## O defeito que isto conserta
 *
 * O WhatsApp passou a endereçar contas por **LID** (`<id>@lid`), um
 * identificador que não é número de telefone e existe justamente para não ser.
 * `toMsisdn` tira o sufixo de qualquer JID, então um LID virava "telefone":
 * dígitos plausíveis, e nada mais.
 *
 * Medido em produção em 2026-11-13. Alguém digitou um celular real na tela de
 * novo atendimento e a tela respondeu:
 *
 *     Tem WhatsApp. Novo na base — será cadastrado ao confirmar.
 *     No WhatsApp ele é 4526996250761 — é assim que fica salvo.
 *
 * `4526996250761` não é telefone de lugar nenhum. Era o LID, e o cadastro
 * nasceria com ele no lugar do número — a mensagem iria para um endereço que não
 * existe, e a ficha ficaria impossível de casar com o inbound.
 *
 * ## Por que nulo, e não o LID
 *
 * Quem chama precisa saber que **não houve** telefone na resposta, para ficar
 * com o que a pessoa digitou — que é um telefone de verdade. Devolver os dígitos
 * do LID é o defeito; devolver string vazia obrigaria cada chamador a lembrar de
 * testar, e o primeiro a esquecer repete o estrago.
 *
 * Isto NÃO troca `toMsisdn` nos caminhos em que o JID é só identificador de
 * conversa (inbound, avatar): lá o LID é o id legítimo daquele chat, e recusá-lo
 * deixaria a conversa sem dono. O que não pode é um LID ser **gravado como
 * telefone**.
 */
export function msisdnDoJid(jid: string | null | undefined): string | null {
    const cru = String(jid ?? '').trim()
    if (!cru) return null

    const servidor = servidorDoJid(cru)
    if (servidor && servidor !== 's.whatsapp.net' && servidor !== 'c.us') return null

    const digitos = toMsisdn(cru).replace(/\D/g, '')
    return digitos.length > 0 ? digitos : null
}

/** Digits only, as both providers expect for a recipient. */
export function normalizeNumber(to: string): string {
    return to.replace(/\D/g, '')
}

/**
 * As duas formas que um celular brasileiro pode ter no WhatsApp.
 *
 * Medido contra a instância em produção: `5531988501161` responde com o JID
 * `553188501161@s.whatsapp.net` — sem o nono dígito. Contas registradas antes
 * da obrigatoriedade do 9 continuam endereçadas pela forma antiga, e é essa a
 * forma que chega no inbound (`toMsisdn(jid)`).
 *
 * Nenhuma das duas é "a certa" por decreto: a busca tenta as duas, e quem
 * decide a canônica é o próprio WhatsApp, pelo JID que devolve. Gravar a forma
 * errada criaria um segundo paciente na primeira mensagem.
 *
 * Mora aqui, e não em `lib/intake`, porque este arquivo não importa nada — e
 * `intake` importa o provedor, que precisa desta função.
 */
export function phoneVariants(digits: string): string[] {
    if (!digits.startsWith('55') || digits.length < 12) return [digits]

    const ddd = digits.slice(2, 4)
    const rest = digits.slice(4)

    if (rest.length === 9 && rest.startsWith('9')) return [digits, `55${ddd}${rest.slice(1)}`]
    if (rest.length === 8) return [digits, `55${ddd}9${rest}`]
    return [digits]
}

/**
 * Se este JID é um **LID** — identificador de conta que não é telefone.
 *
 * `msisdnDoJid` já recusa LID devolvendo nulo, e serve a quem precisa de
 * telefone ou nada. Este predicado serve a quem precisa saber **qual** das duas
 * coisas chegou, para guardar o LID na coluna dele em vez de descartá-lo: no
 * inbound o LID é a única identidade que temos daquela conversa, e perdê-la
 * deixaria o fio sem dono.
 */
export function ehJidDeLid(jid: string | null | undefined): boolean {
    return servidorDoJid(String(jid ?? '').trim()) === 'lid'
}

/**
 * O LID cru de um JID de LID, sem sufixo nem dispositivo. Nulo para o resto.
 *
 * Existe para que a coluna `Contact.lid` guarde sempre a mesma forma — o JID
 * com sufixo chega às vezes com `:12` de dispositivo, e duas formas na mesma
 * coluna criariam duas fichas para a mesma conta.
 */
export function lidDoJid(jid: string | null | undefined): string | null {
    if (!ehJidDeLid(jid)) return null
    const digitos = toMsisdn(String(jid)).replace(/\D/g, '')
    return digitos.length > 0 ? digitos : null
}

/**
 * O telefone escondido no `Info` de um evento do whatsmeow, quando o endereço
 * principal é LID.
 *
 * ## Por que varrer o objeto em vez de ler um campo
 *
 * O whatsmeow carrega o **par**: endereçada por LID, a mensagem traz o telefone
 * num campo alternativo (`SenderAlt`, e em versões diferentes `ChatAlt` ou
 * `RecipientAlt`). O Evolution Go serializa a struct do Go direto para JSON, de
 * modo que o nome do campo é o nome do campo do Go — e ele **mudou de nome
 * entre versões do whatsmeow**. Ler um nome fixo é apostar na versão que está
 * no VPS; se a aposta falha, falha em silêncio, criando ficha com LID por
 * telefone, que é exatamente o defeito que isto conserta.
 *
 * Então o critério não é o nome da chave, é a **forma do valor**: qualquer JID
 * de telefone (`@s.whatsapp.net`) dentro do `Info` é o telefone de quem
 * escreveu. Há um só por evento de conversa individual, e um LID nunca casa com
 * este formato — é `@lid`.
 *
 * `Info.Chat`/`Info.Sender` entram na varredura sem prejuízo: se eles já forem
 * telefone, quem chama não precisou desta função.
 *
 * Fora do nosso alcance: evento de **grupo**, onde `Chat` é `@g.us` e há vários
 * participantes. Por isso quem chama só pergunta em conversa individual.
 */
export function telefoneAlternativoNoInfo(info: unknown): string | null {
    if (!info || typeof info !== 'object') return null

    for (const valor of Object.values(info as Record<string, unknown>)) {
        if (typeof valor !== 'string') continue
        const telefone = msisdnDoJid(valor)
        // `msisdnDoJid` só devolve dígitos para `@s.whatsapp.net`/`@c.us`; a
        // exigência do `@` é o que impede um campo qualquer de texto de passar.
        if (telefone && valor.includes('@')) return telefone
    }

    return null
}

/**
 * Se dá para enviar para este endereço — a última conferência antes do provedor.
 *
 * ## O que esta função NÃO faz
 *
 * Não distingue LID de telefone **pelos dígitos**, porque não dá: um LID
 * medido em produção é `4526996250761`, treze dígitos começando em 45, que é o
 * código da Dinamarca. E o E.164 admite quinze dígitos, então nem o tamanho
 * separa os dois. Quem tentar essa separação aqui vai recusar o telefone de
 * algum cliente estrangeiro algum dia, e com uma mensagem que não explica nada.
 *
 * A separação é **na coluna**, acima: o inbound grava telefone em `phone` e LID
 * em `lid` (ver `Contact.lid`), então um LID nunca chega aqui como destino. O
 * que chega, e é o que isto pega, é o **destino vazio** — a ficha cujo telefone
 * é desconhecido justamente porque só havia LID.
 *
 * No Instagram o destino é o IGSID e não tem forma de telefone nenhuma; lá a
 * única pergunta é se existe.
 */
export function ehDestinoEnviavel(to: string | null | undefined, channel: string): boolean {
    const cru = String(to ?? '').trim()
    if (!cru) return false
    if (channel === 'instagram') return true

    const digitos = cru.replace(/\D/g, '')
    // Oito é o menor telefone nacional ainda em uso; quinze é o teto do E.164.
    return digitos.length >= 8 && digitos.length <= 15
}
