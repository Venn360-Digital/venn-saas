import 'server-only'
import { AwsClient } from 'aws4fetch'

/**
 * O envio de campanha, pela API do Amazon SES v2.
 *
 * ## Por que SES e não o Email Sending da Cloudflare
 *
 * O transacional continua na Cloudflare (ver `send.ts`) e não muda. Campanha é
 * outro problema: ela **tem de sair do domínio do cliente**, e na Cloudflare
 * isso não cabe. A documentação exige "you must be using Cloudflare DNS to use
 * Email Service" e o onboarding só oferece domínio da própria conta; adicionar
 * apenas `mkt.clinica.com.br` como zona (*subdomain setup*) é recurso
 * Enterprise. O caminho restante seria a clínica apontar os **nameservers** do
 * domínio inteiro para a nossa conta — passaríamos a responder pelo site e pelo
 * MX do Google Workspace dela.
 *
 * No SES o cliente acrescenta **três CNAME** na zona que já tem e mantém o DNS
 * onde está. E a cota deixa de ser um balde só: na Cloudflare ela é **da conta**
 * (hoje 200/dia), compartilhada entre todas as unidades e com a recuperação de
 * senha; aqui a reputação é por domínio verificado, então reclamação de um
 * cliente não contamina os outros nem o transacional.
 *
 * ## Por que `aws4fetch`, e por que isto não é dependência nova
 *
 * O projeto já assina SigV4 com ele em `src/lib/storage/s3.ts`, pelo mesmo
 * motivo: 64 KB contra megabytes, e assina com WebCrypto e `fetch`, que existem
 * tanto em Workers quanto no Node. O SDK da AWS carregaria polyfills de Node
 * para as quatro chamadas que este módulo faz.
 *
 * ## Nunca lança
 *
 * Mesma regra de `sendEmail`: a falha volta no retorno. Um envio de campanha
 * roda dentro do fan-out da fila, e exceção ali viraria retentativa do lote
 * inteiro — reenviando a quem já recebeu. Quem chama decide se marca o
 * destinatário como falho ou se tenta de novo.
 */

/** O endpoint regional do SES v2. */
function endpoint(region: string): string {
    return `https://email.${region}.amazonaws.com/v2/email`
}

export interface CredenciaisDoSes {
    accessKeyId: string
    secretAccessKey: string
    region: string
}

/**
 * As credenciais, lidas do ambiente.
 *
 * Não é binding: SES é HTTPS com chave, não recurso da plataforma. Por isso
 * chega por `process.env` como as outras chaves de terceiro
 * (`OPENAI_API_KEY`), e não por `registrarCosturas`.
 *
 * Devolve `null` quando falta credencial, e quem chama responde "SES não
 * configurado" — que é o estado correto num app onde a feature ainda não foi
 * ligada. Lançar aqui derrubaria o cron de verificação de remetente nos apps
 * que ainda não têm a chave gravada.
 */
export function credenciaisDoSes(): CredenciaisDoSes | null {
    const accessKeyId = process.env.SES_ACCESS_KEY_ID
    const secretAccessKey = process.env.SES_SECRET_ACCESS_KEY
    if (!accessKeyId || !secretAccessKey) return null

    return {
        accessKeyId,
        secretAccessKey,
        /**
         * `us-east-2` é a região da conta (confirmado em 2026-11-08).
         *
         * Região **é parte da identidade do SES**: domínio verificado,
         * configuration set, cota e estado de sandbox são todos por região.
         * Apontar para a região errada dá `NotFoundException` sem dizer por quê.
         *
         * A latência não importa: todo envio passa pela fila.
         */
        region: process.env.SES_REGION ?? 'us-east-2',
    }
}

function cliente(cred: CredenciaisDoSes): AwsClient {
    return new AwsClient({
        accessKeyId: cred.accessKeyId,
        secretAccessKey: cred.secretAccessKey,
        // O SES v2 assina como `ses`, não como `email` — o nome do serviço não
        // acompanha o do host.
        service: 'ses',
        region: cred.region,
    })
}

/**
 * Códigos de erro do SES em que repetir não ajuda.
 *
 * `MessageRejected` fica **fora** de propósito: ele cobre tanto conteúdo
 * recusado (definitivo) quanto problema momentâneo de reputação, e tratar o
 * segundo como definitivo descartaria envio que a próxima tentativa entregaria.
 */
const DEFINITIVOS = new Set([
    'BadRequestException',
    'MailFromDomainNotVerifiedException',
    'AccountSuspendedException',
    'SendingPausedException',
    'NotFoundException',
])

type Resposta =
    | { ok: true; corpo: Record<string, unknown> }
    | { ok: false; error: string; definitivo: boolean }

async function chamar(
    cred: CredenciaisDoSes,
    caminho: string,
    init: { method: string; body?: unknown }
): Promise<Resposta> {
    try {
        const resposta = await cliente(cred).fetch(`${endpoint(cred.region)}${caminho}`, {
            method: init.method,
            headers: { 'Content-Type': 'application/json' },
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
        })

        const texto = await resposta.text()
        const corpo = texto ? comoObjeto(texto) : {}

        if (!resposta.ok) {
            // O SES devolve o tipo do erro no corpo (`__type`) e às vezes só no
            // cabeçalho. É esse tipo que diz se insistir tem sentido.
            const tipo =
                textoDe(corpo.__type)?.split('#').pop() ??
                resposta.headers.get('x-amzn-ErrorType')?.split(':')[0] ??
                `HTTP ${resposta.status}`
            const mensagem =
                textoDe(corpo.message) ?? textoDe(corpo.Message) ?? texto.slice(0, 200)

            return {
                ok: false,
                error: `${tipo}: ${mensagem}`.slice(0, 500),
                // 4xx que não seja 429 não melhora com retentativa.
                definitivo:
                    DEFINITIVOS.has(tipo) ||
                    (resposta.status >= 400 && resposta.status < 500 && resposta.status !== 429),
            }
        }

        return { ok: true, corpo }
    } catch (erro) {
        // Rede. Sempre vale tentar de novo.
        return {
            ok: false,
            error: erro instanceof Error ? erro.message : 'falha de rede',
            definitivo: false,
        }
    }
}

function comoObjeto(texto: string): Record<string, unknown> {
    try {
        const valor: unknown = JSON.parse(texto)
        return typeof valor === 'object' && valor !== null
            ? (valor as Record<string, unknown>)
            : {}
    } catch {
        return {}
    }
}

function textoDe(valor: unknown): string | undefined {
    return typeof valor === 'string' && valor.length > 0 ? valor : undefined
}

function listaDeTextos(valor: unknown): string[] {
    return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string') : []
}

function objetoDe(valor: unknown): Record<string, unknown> {
    return typeof valor === 'object' && valor !== null ? (valor as Record<string, unknown>) : {}
}

// ───────────────────────────────── Envio ─────────────────────────────────

export interface ResultadoDeEnvio {
    ok: boolean
    /** O `MessageId` do SES. É por ele que o recibo (bounce, abertura) se liga. */
    messageId?: string
    error?: string
    /**
     * `true` quando repetir não vai ajudar: endereço inválido, remetente não
     * verificado, destinatário na lista de supressão. O fan-out usa isto para
     * marcar `failed` em vez de devolver o job à fila.
     */
    definitivo?: boolean
}

export interface EnvioDeCampanha {
    /** Endereço num domínio já verificado. Ex.: `contato@clinica.com.br`. */
    de: string
    /** O nome que aparece na caixa de entrada. */
    nomeDoRemetente: string
    /** Para onde responder quando a pessoa aperta "responder". */
    responderPara?: string
    para: string
    assunto: string
    html: string
    texto: string
    /**
     * O configuration set do workspace. É ele que liga os eventos (entrega,
     * abertura, clique, reclamação) ao SNS — sem ele o envio sai e **nenhum
     * recibo volta**.
     */
    configurationSet?: string
    /**
     * O link de descadastro, publicado em cabeçalho.
     *
     * `List-Unsubscribe` com `List-Unsubscribe-Post` é o que faz Gmail e Outlook
     * mostrarem o botão nativo de cancelar inscrição, e o SES emitir o evento
     * `Subscription` quando alguém o usa. Isso **reduz reclamação de spam**, que
     * é a métrica que derruba reputação de domínio: quem quer sair aperta o
     * botão em vez de marcar como lixo.
     */
    descadastroUrl?: string
    /**
     * Carimbos que voltam em cada evento do SES.
     *
     * É o que deixa o recibo achar o destinatário sem procurar pelo endereço —
     * e procurar pelo endereço seria ambíguo, porque o mesmo e-mail pode estar
     * em duas campanhas ao mesmo tempo. Só aceita `[A-Za-z0-9_-]`, limite do
     * SES, então quem chama passa ids (cuid), nunca nome.
     */
    tags?: Record<string, string>
}

/**
 * Manda um e-mail de campanha.
 *
 * Usa `Simple` (assunto + corpo), não `Raw`: o SES monta o MIME, assina DKIM e
 * cuida do `Return-Path`. Montar MIME à mão só seria preciso para anexo, que
 * campanha não tem — e-mail de marketing com anexo cai em spam.
 */
export async function enviarPorSes(envio: EnvioDeCampanha): Promise<ResultadoDeEnvio> {
    const cred = credenciaisDoSes()
    if (!cred) return { ok: false, error: 'SES não configurado', definitivo: true }

    const cabecalhos: { Name: string; Value: string }[] = []
    if (envio.descadastroUrl) {
        cabecalhos.push({ Name: 'List-Unsubscribe', Value: `<${envio.descadastroUrl}>` })
        cabecalhos.push({ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' })
    }

    const resultado = await chamar(cred, '/outbound-emails', {
        method: 'POST',
        body: {
            // O nome vai entre aspas: clínica com vírgula no nome ("Odonto, Ltda")
            // quebraria o cabeçalho em dois endereços sem elas.
            FromEmailAddress: `"${envio.nomeDoRemetente.replace(/"/g, '')}" <${envio.de}>`,
            Destination: { ToAddresses: [envio.para] },
            ...(envio.responderPara ? { ReplyToAddresses: [envio.responderPara] } : {}),
            ...(envio.configurationSet ? { ConfigurationSetName: envio.configurationSet } : {}),
            Content: {
                Simple: {
                    Subject: { Data: envio.assunto, Charset: 'UTF-8' },
                    Body: {
                        // Sempre os dois. E-mail só-HTML pesa contra a entrega, e
                        // é a mesma regra que `send.ts` já segue no transacional.
                        Text: { Data: envio.texto, Charset: 'UTF-8' },
                        Html: { Data: envio.html, Charset: 'UTF-8' },
                    },
                    ...(cabecalhos.length > 0 ? { Headers: cabecalhos } : {}),
                },
            },
            ...(envio.tags
                ? {
                      EmailTags: Object.entries(envio.tags).map(([Name, Value]) => ({
                          Name,
                          Value,
                      })),
                  }
                : {}),
        },
    })

    if (!resultado.ok) {
        return { ok: false, error: resultado.error, definitivo: resultado.definitivo }
    }

    return { ok: true, messageId: textoDe(resultado.corpo.MessageId) }
}

// ────────────────────────────── Identidade ──────────────────────────────

export interface Identidade {
    /** Os tokens do DKIM. Viram os três CNAME que o cliente publica. */
    tokens: string[]
    /** `PENDING` | `SUCCESS` | `FAILED` | `TEMPORARY_FAILURE` | `NOT_STARTED` */
    dkimStatus: string
    /** `true` só quando o SES aceita enviar por este domínio. */
    prontaParaEnvio: boolean
}

/**
 * Registra o domínio do cliente no SES e devolve os tokens do DKIM.
 *
 * Pede **Easy DKIM com RSA 2048** (`NextSigningKeyLength`): o SES gera e gira a
 * chave sozinho, e o cliente publica três CNAME que apontam para o SES em vez
 * de um TXT com chave pública que envelheceria na mão dele.
 *
 * Três CNAME bastam para o DMARC passar, porque o `d=` do DKIM fica alinhado
 * com o domínio do `From`. Custom MAIL FROM alinharia o SPF também, mas pede MX
 * e TXT adicionais na zona do cliente — fica como melhoria, não requisito.
 */
export async function criarIdentidade(
    dominio: string,
    configurationSet?: string
): Promise<{ ok: true; identidade: Identidade } | { ok: false; error: string }> {
    const cred = credenciaisDoSes()
    if (!cred) return { ok: false, error: 'SES não configurado' }

    const resultado = await chamar(cred, '/identities', {
        method: 'POST',
        body: {
            EmailIdentity: dominio,
            DkimSigningAttributes: { NextSigningKeyLength: 'RSA_2048_BIT' },
            ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
        },
    })

    if (resultado.ok) {
        const dkim = objetoDe(resultado.corpo.DkimAttributes)
        return {
            ok: true,
            identidade: {
                tokens: listaDeTextos(dkim.Tokens),
                dkimStatus: textoDe(dkim.Status) ?? 'PENDING',
                prontaParaEnvio: resultado.corpo.VerifiedForSendingStatus === true,
            },
        }
    }

    /**
     * Domínio já registrado não é erro.
     *
     * Acontece de verdade: duas unidades da mesma rede querem enviar pelo mesmo
     * domínio, ou alguém refaz o cadastro depois de apagar a linha. O SES guarda
     * uma identidade por domínio na conta, então a resposta certa é **ler a que
     * existe** e devolver os mesmos tokens — recriar apagaria o DKIM que já está
     * publicado na zona do cliente e pararia o envio de quem já funcionava.
     */
    if (resultado.error.startsWith('AlreadyExistsException')) {
        return lerIdentidade(dominio)
    }

    return { ok: false, error: resultado.error }
}

/** Consulta o estado do DKIM. É o que o cron de verificação chama. */
export async function lerIdentidade(
    dominio: string
): Promise<{ ok: true; identidade: Identidade } | { ok: false; error: string }> {
    const cred = credenciaisDoSes()
    if (!cred) return { ok: false, error: 'SES não configurado' }

    const resultado = await chamar(cred, `/identities/${encodeURIComponent(dominio)}`, {
        method: 'GET',
    })
    if (!resultado.ok) return { ok: false, error: resultado.error }

    const dkim = objetoDe(resultado.corpo.DkimAttributes)
    return {
        ok: true,
        identidade: {
            tokens: listaDeTextos(dkim.Tokens),
            dkimStatus: textoDe(dkim.Status) ?? 'PENDING',
            prontaParaEnvio: resultado.corpo.VerifiedForSendingStatus === true,
        },
    }
}

// ────────────────────────────── Supressão ──────────────────────────────

export type MotivoDeSupressao = 'BOUNCE' | 'COMPLAINT'

/**
 * Põe um endereço na lista de supressão da conta.
 *
 * O SES recusa envio a quem está nela, **antes** de gastar reputação. É a rede
 * de segurança por baixo do `Contact.emailOptOutAt`: a coluna protege o contato
 * naquele workspace, e a supressão protege o domínio contra reenvio por outro
 * caminho — import novo, outra lista, outra unidade da mesma conta.
 *
 * Indisponível enquanto a conta está no sandbox ("bulk actions and SES API calls
 * related to suppression list management are disabled"), então a falha aqui
 * **não** pode derrubar o processamento do recibo: quem chama registra e segue.
 */
export async function suprimir(
    email: string,
    motivo: MotivoDeSupressao
): Promise<{ ok: boolean; error?: string }> {
    const cred = credenciaisDoSes()
    if (!cred) return { ok: false, error: 'SES não configurado' }

    /**
     * `PUT /suppression/addresses` — **sem** o endereço no caminho.
     *
     * O caminho com o endereço (`/suppression/addresses/{email}`) existe, mas é
     * do `GetSuppressedDestination` e do `DeleteSuppressedDestination`. Um PUT
     * nele não é rota nenhuma, e o SES responde `404 UnknownOperationException`
     * — erro que não diz "caminho errado" e que o sandbox explica mal, porque a
     * supressão de fato também está desabilitada no sandbox. Medido pela própria
     * CLI (`aws sesv2 put-suppressed-destination --debug`), que monta
     * `url_path: '/v2/email/suppression/addresses'`.
     *
     * Logo o endereço vai **no corpo**, junto do motivo.
     */
    const resultado = await chamar(cred, '/suppression/addresses', {
        method: 'PUT',
        body: { EmailAddress: email, Reason: motivo },
    })

    return resultado.ok ? { ok: true } : { ok: false, error: resultado.error }
}
