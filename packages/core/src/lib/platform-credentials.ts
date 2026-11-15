import prisma from '@venn/db/cliente'
import { usuarioDaSessao } from './auth/sessao'
import { platformSecretName, readVaultSecret, vaultSecretOrigin } from './vault'
import { nomeDeAmbiente } from './secrets/ambiente'
import { BRAND } from '../marca'

/**
 * The OAuth application's own credentials, registered once for every clinic.
 *
 * A clinic clicks "Conectar", picks its account — `contato@clinicaabc.com.br` —
 * and is done. It does not create a Google Cloud project, because the project
 * is the product's, not the clinic's. The same mechanism serves every provider
 * that has an app registration: Google Calendar today, Google Ads, Meta Ads and
 * Clinicorp next.
 *
 * A workspace may still register its own application in `Integration.credentials`
 * and that wins — a clinic on Google Workspace may prefer an Internal app, which
 * avoids Google's verification review and the 7-day refresh token of an
 * unpublished External one.
 *
 * ## ONDE ESTAS CREDENCIAIS MORAM, E POR QUE NÃO HÁ MAIS TELA
 *
 * Elas vêm do **ambiente** — Cloudflare Secrets, gravados por quem opera a
 * plataforma, declarados em `cloudflare.config.ts` e nunca pelo repositório.
 * Uma por provedor, com nome derivado: `PLATFORM_<PROVEDOR>_CLIENT_ID` e
 * `PLATFORM_<PROVEDOR>_CLIENT_SECRET` (ver `variaveisDoProvedor`).
 *
 * Até 2026-10-24 havia um formulário onde o responsável pela plataforma
 * digitava as duas metades, e elas iam para a tabela `app_secrets` cifradas. A
 * ponte saiu por decisão do André, e a razão resiste a ser reescrita:
 *
 *   - a primeira metade do Asaas **é a chave que move dinheiro**. Um formulário
 *     web para ela significa que uma sessão de navegador — roubada, ou de uma
 *     aba esquecida — é caminho para trocar a credencial de cobrança;
 *   - o segredo de operação não é dado de inquilino. Misturá-los fazia o mesmo
 *     banco guardar o que é da plataforma e o que é das clínicas, com a mesma
 *     chave de envelope;
 *   - e não resolvia o problema que parecia resolver: o cofre **já** dava
 *     precedência ao ambiente e `writeVaultSecret` recusava gravar o que
 *     estivesse lá. Em produção a tela seria sempre somente-leitura.
 *
 * O que a tela faz agora é **dizer qual variável falta**, e isso é melhor que
 * um formulário: o operador grava pelo terminal, onde o valor não passa por
 * navegador nenhum, e a tela confirma que chegou.
 *
 * A linha de `platform_credentials` continua existindo para o que é **público**
 * — o `clientId` que vai ao navegador dentro do SDK da Meta. É cache, não
 * fonte: ver `semearDoAmbiente`.
 */

export interface OAuthAppCredentials {
    clientId: string
    clientSecret: string
}

/**
 * Função memoizada, e não constante: o texto lê o vocabulário, e `BRAND()` é
 * fail-fast. Constante de módulo é avaliada quando a Cloudflare VALIDA o
 * script — sem requisição e sem marca registrada —, e a publicação reprova com
 * `MarcaNaoRegistradaError`. A forma que já reprovou cinco publicações.
 */
function montarPlatformProviders() {
    return [
    { provider: 'google_calendar', label: 'Google Calendar', help: 'Projeto no Google Cloud com a Calendar API ativa.' },
    { provider: 'google_ads', label: 'Google Ads', help: 'Mesmo projeto do Google, com a Ads API ativa.' },
    { provider: 'meta_ads', label: 'Meta Ads', help: 'App no Meta for Developers.' },
    {
        provider: 'meta_messaging',
        label: 'WhatsApp API Oficial (Meta)',
        help: `App ${BRAND().name} no portfólio ${BRAND().vendor}, em Configurações → Básico.`,
        idLabel: 'ID do aplicativo',
        secretLabel: 'Chave secreta do aplicativo',
    },
    {
        provider: 'instagram_login',
        label: 'Instagram Direct',
        /**
         * O caminho inteiro, porque esta tela some do painel se você piscar.
         *
         * No modelo novo da Meta os produtos não ficam no menu lateral: moram
         * dentro do caso de uso. E lá existem duas entradas quase idênticas,
         * truncadas na tela — a do login do Facebook e a do login do Instagram.
         * Queremos a segunda.
         */
        help: 'Casos de uso → API do Instagram → Configuração da API com login do Instagram → Configurar o login empresarial. Atenção: há duas entradas parecidas no menu; a do login do Facebook não serve.',
        /**
         * Rótulos no vocabulário da Meta, e não "Client ID".
         *
         * São credenciais próprias do produto Instagram, **diferentes** das do
         * aplicativo do Facebook que está logo acima nesta mesma lista. Com
         * dois campos genéricos chamados "Client ID", colar o par errado é o
         * desfecho provável — e o erro que isso produz não diz qual dos dois
         * está errado.
         */
        idLabel: 'ID do aplicativo do Instagram',
        secretLabel: 'Chave secreta do aplicativo do Instagram',
    },
    { provider: 'clinicorp', label: 'Clinicorp', help: 'Token de integração fornecido pelo Clinicorp.' },
    {
        provider: 'asaas',
        label: 'Asaas (cobrança)',
        help:
            'Chave de API em Configurações → Integrações → API. Use a de sandbox ' +
            '($aact_hmlg_) até a cobrança ser provada ponta a ponta. O token do ' +
            'webhook é inventado por você aqui e colado no painel do Asaas ao ' +
            'cadastrar a URL — ele não é a chave de API.',
        idLabel: 'Chave de API',
        secretLabel: 'Token do webhook',
        /**
         * As duas metades são segredo, e nenhuma é pública.
         *
         * O par OAuth dos outros provedores é "id público + segredo"; aqui o
         * primeiro campo é a chave que move dinheiro. Com isto, ela vai para o
         * cofre como a segunda e **nunca** é devolvida para a tela.
         */
        segredoDuplo: true,
    },
] as const
}
let platformProvidersCache: ReturnType<typeof montarPlatformProviders> | null = null
export function PLATFORM_PROVIDERS(): ReturnType<typeof montarPlatformProviders> {
    if (platformProvidersCache === null) platformProvidersCache = montarPlatformProviders()
    return platformProvidersCache
}

export type PlatformProvider = ReturnType<typeof PLATFORM_PROVIDERS>[number]['provider']

/**
 * Sandbox ou produção, lido do prefixo da chave do Asaas.
 *
 * Eles são autodescritivos — `$aact_hmlg_` e `$aact_prod_` —, então perguntar o
 * ambiente numa caixa de seleção seria convidar a marcar errado e cobrar de
 * verdade num teste. "desconhecido" para chave que não segue o padrão, que é
 * sinal de chave colada pela metade.
 */
export function ambienteDaChave(chave: string): 'sandbox' | 'producao' | 'desconhecido' {
    if (chave.startsWith('$aact_hmlg_')) return 'sandbox'
    if (chave.startsWith('$aact_prod_')) return 'producao'
    return 'desconhecido'
}

/** Se as duas metades deste provedor são segredo. Ver o descritor do Asaas. */
export function temSegredoDuplo(provider: string): boolean {
    const p = PLATFORM_PROVIDERS().find((x) => x.provider === provider)
    return Boolean(p && 'segredoDuplo' in p && p.segredoDuplo)
}

/** O nome do segredo onde mora a primeira metade, quando ela também é segredo. */
const CAMPO_ID = 'clientId'

/**
 * De onde cada metade vem, e por quê.
 *
 * O **clientId** fica na coluna, em claro: ele é público — vai para o navegador
 * dentro do SDK de qualquer jeito — e guardar valor público num cofre só faria
 * parecer que ele é secreto.
 *
 * O **clientSecret** vem do Vault, cifrado. Ver `lib/vault.ts` para o porquê de
 * não ser nem o `.env` nem a coluna em texto puro.
 */
export async function getPlatformCredentials(provider: string): Promise<OAuthAppCredentials | null> {
    const row = await prisma.platformCredential.findUnique({
        where: { provider },
        select: { credentials: true },
    })
    const creds = (row?.credentials ?? {}) as Partial<OAuthAppCredentials>

    /**
     * As duas metades vêm do MESMO lugar, e o lugar é o ambiente.
     *
     * Antes o `clientId` dos provedores de metade pública saía da coluna,
     * porque havia uma tela onde o responsável pela plataforma o digitava. Essa
     * ponte saiu em 2026-10-24 (ver o cabeçalho deste módulo): a coluna
     * continua existindo como cache do que é público, mas a **fonte** é
     * `PLATFORM_<PROVEDOR>_CLIENT_ID`, resolvido por `readVaultSecret` —
     * ambiente primeiro, cofre depois.
     *
     * A ordem importa num caso só, e é o que esta função garante: ambiente
     * vence a coluna. Credencial que o operador acabou de gravar no Cloudflare
     * Secrets não pode perder para um valor antigo que sobrou no banco.
     */
    const clientId =
        (await readVaultSecret(platformSecretName(provider, CAMPO_ID))) ??
        idDeSemente(provider) ??
        creds.clientId ??
        null
    const clientSecret = await readVaultSecret(platformSecretName(provider))

    if (clientId && clientSecret) return { clientId, clientSecret }

    // Nada guardado ainda: tenta o ambiente, que é o canal por onde o
    // responsável pela plataforma injeta a primeira vez. Ver `semearDoAmbiente`.
    return semearDoAmbiente(provider)
}

/**
 * O ambiente como primeira carga, numa base recém-criada.
 *
 * **O que mudou na ida para a Cloudflare.** Na VPS isto era "copiar do `.env`
 * para o Vault", porque o `.env` era texto puro no mesmo disco do banco e
 * servia para injetar, não para guardar. Em Workers o ambiente **é** o cofre:
 * o segredo está em Cloudflare Secrets, cifrado em repouso e fora do bundle.
 * Não há mais para onde copiá-lo, e `writeVaultSecret` recusa a tentativa de
 * propósito — ver `lib/vault.ts`.
 *
 * O que sobra para esta função é o que o ambiente **não** carrega: a linha de
 * `platform_credentials`, que guarda o `clientId` público e o "quem alterou e
 * quando" que a tela mostra. Num banco Neon novo essa linha não existe, e sem
 * ela a tela diria "não configurado" com o segredo já publicado no Worker.
 *
 * O `clientId` continua vindo de variável comum (`META_APP_ID`): ele é público,
 * vai para o navegador dentro do SDK, e não é segredo para estar em secret.
 */
const SEMENTES: Record<string, { id?: string }> = {
    meta_messaging: { id: 'META_APP_ID' },
    instagram_login: { id: 'INSTAGRAM_APP_ID' },
}

/** O nome antigo do id, mantido para não quebrar quem já o gravou. */
function idDeSemente(provider: string): string | null {
    const nome = SEMENTES[provider]?.id
    return (nome && process.env[nome]?.trim()) || null
}

async function semearDoAmbiente(provider: string): Promise<OAuthAppCredentials | null> {
    const nomes = SEMENTES[provider]
    if (!nomes?.id) return null

    const clientId = process.env[nomes.id]?.trim()
    if (!clientId) return null

    /**
     * O segredo vem do cofre, que resolve em Cloudflare Secrets. Se não está
     * publicado, não há o que semear: devolver metade da credencial faria o
     * fluxo de OAuth falhar mais tarde, longe daqui.
     */
    const clientSecret = await readVaultSecret(platformSecretName(provider))
    if (!clientSecret) return null

    /**
     * Grava **só a coluna**. O segredo já está no lugar certo, e mandá-lo para
     * `setPlatformCredentials` aqui seria pedir uma gravação que o cofre recusa.
     */
    await prisma.platformCredential.upsert({
        where: { provider },
        create: { provider, credentials: { clientId }, updatedBy: 'ambiente' },
        update: { credentials: { clientId }, updatedBy: 'ambiente' },
    })

    console.warn(
        `[PLATFORM_CREDENTIALS] ${provider}: clientId lido de ${nomes.id} e gravado na coluna; ` +
            `o segredo veio do Cloudflare Secrets (${platformSecretName(provider)}).`
    )

    return { clientId, clientSecret }
}

/**
 * Onde cada metade deste provedor é definida, pelo nome da variável.
 *
 * A tela deixou de ter formulário: ela informa **qual variável falta**. O nome
 * não é escolhido aqui — sai de `nomeDeAmbiente` sobre o nome do segredo no
 * cofre, que é o mesmo que `readVaultSecret` consulta. Derivar em vez de
 * repetir é o que impede a tela de mandar o operador gravar um nome que o
 * código não lê.
 */
export function variaveisDoProvedor(provider: string): { id: string; segredo: string } {
    return {
        id: nomeDeAmbiente(platformSecretName(provider, CAMPO_ID)),
        segredo: nomeDeAmbiente(platformSecretName(provider)),
    }
}

/** Se as duas metades estão definidas, e de onde vêm. */
export async function estadoDoProvedor(provider: string): Promise<{
    temId: boolean
    temSegredo: boolean
    origem: 'ambiente' | 'banco' | null
    variaveis: { id: string; segredo: string }
}> {
    const variaveis = variaveisDoProvedor(provider)
    const [origemDoId, origemDoSegredo] = await Promise.all([
        vaultSecretOrigin(platformSecretName(provider, CAMPO_ID)),
        vaultSecretOrigin(platformSecretName(provider)),
    ])

    /**
     * O id também conta como "de semente" quando veio do alias antigo
     * (`META_APP_ID`), que é ambiente do mesmo jeito.
     */
    const temId = origemDoId !== null || idDeSemente(provider) !== null

    /**
     * A origem que a tela mostra é a do **segredo**: é ela que diz se a
     * credencial está no cofre da Cloudflare ou sobrou no banco de uma
     * gravação antiga, de quando existia formulário.
     */
    return { temId, temSegredo: origemDoSegredo !== null, origem: origemDoSegredo, variaveis }
}

/**
 * O que do aplicativo da Meta pode ir ao navegador.
 *
 * Os dois são públicos por natureza: o id do aplicativo vai no SDK do Facebook,
 * e o id da configuração diz ao SDK **qual fluxo abrir** — qual conjunto de
 * permissões pedir e quais ativos oferecer à clínica. Nenhum dos dois autoriza
 * nada sozinho; quem autoriza é a chave secreta, que fica no Vault e não sai do
 * servidor.
 *
 * O id da configuração mora em `metadata` e não em `credentials` porque não é
 * credencial: guardá-lo junto do segredo faria parecer que é.
 *
 * **São duas configurações, não uma.** O WhatsApp e o Instagram pedem conjuntos
 * de permissões diferentes, e no Login do Facebook para Empresas cada conjunto é
 * uma configuração própria no painel da Meta. Usar a do WhatsApp para ligar o
 * Instagram abriria a janela pedindo permissão de WhatsApp — e o fluxo
 * terminaria sem a conta que precisávamos.
 */
export async function getMetaPublicConfig(): Promise<{
    appId: string
    configId: string | null
    instagramConfigId: string | null
} | null> {
    const row = await prisma.platformCredential.findUnique({
        where: { provider: 'meta_messaging' },
        select: { credentials: true, metadata: true },
    })

    const appId = (row?.credentials as { clientId?: string } | null)?.clientId
    const metadata = (row?.metadata ?? {}) as {
        configId?: string
        instagramConfigId?: string
    }

    if (!appId) return null
    return {
        appId,
        configId: metadata.configId ?? null,
        instagramConfigId: metadata.instagramConfigId ?? null,
    }
}

export interface PlatformAdmin {
    userId: string
    workspaceId: string
}

/**
 * The caller, if they are OWNER of the workspace that operates the product.
 *
 * Deliberately derived from the role that already exists plus one flag on the
 * workspace, rather than a separate list of privileged e-mails: a second
 * permission list is a second thing to keep in sync, and it drifts.
 */
export async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
    const user = await usuarioDaSessao()
    if (!user) return null

    const membership = await prisma.workspaceUser.findFirst({
        where: {
            userId: user.id,
            isActive: true,
            role: 'OWNER',
            workspace: { isPlatform: true },
        },
        select: { workspaceId: true },
    })
    if (!membership) return null
    return { userId: user.id, workspaceId: membership.workspaceId }
}
