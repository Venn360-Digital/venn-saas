import { getPlatformCredentials, ambienteDaChave } from '../platform-credentials'
import { BRAND } from '../../marca'

/**
 * O cliente do Asaas: fino de propósito.
 *
 * Não é um SDK nem um wrapper por recurso. É a chamada autenticada com a URL
 * certa, e cada caso de uso monta o seu corpo. A razão é a mesma que já vale
 * para o Evolution: um wrapper por endpoint envelhece com a API deles e esconde
 * o que está sendo enviado justamente onde isso importa — cobrança.
 *
 * O AMBIENTE SAI DA CHAVE
 *
 * As chaves do Asaas são autodescritivas: `$aact_hmlg_` é sandbox,
 * `$aact_prod_` é produção. Então não há configuração de ambiente para alguém
 * marcar errado e cobrar de verdade num teste — a URL é escolhida pela chave que
 * está guardada.
 *
 * A CHAVE VEM DO COFRE, NUNCA DO ENV
 *
 * Mesmo padrão das credenciais de plataforma do Google e da Meta: guardada
 * cifrada e lida na hora. Ver `lib/platform-credentials.ts` e `lib/vault.ts`.
 */

const BASE = {
    sandbox: 'https://api-sandbox.asaas.com/v3',
    producao: 'https://api.asaas.com/v3',
} as const

/**
 * O `User-Agent` é pedido pela documentação deles.
 *
 * Não é formalidade: quando duas integrações do mesmo cliente se comportam
 * diferente, é por ele que o suporte do Asaas separa uma da outra.
 */
/** Função: `BRAND()` lança se a marca não foi registrada, e constante de módulo
 * é avaliada na validação do script. */
const userAgent = () => `${BRAND().name}/1.0 (Next.js)`

export interface AsaasConfig {
    chave: string
    ambiente: 'sandbox' | 'producao'
    base: string
}

/**
 * ⚠️ Os nomes têm FORMA de OAuth e CONTEÚDO de outra coisa.
 *
 * `clientId` e `clientSecret` (em `PLATFORM_ASAAS_CLIENT_ID` e
 * `PLATFORM_ASAAS_CLIENT_SECRET`) sugerem um par de credenciais OAuth. Não é
 * isso, e a confusão já custou uma pergunta em 18/11/2026:
 *
 *   clientId      → a CHAVE DE API da Asaas. Vai no header `access_token`
 *                   (não `Authorization`), e o PREFIXO dela carrega o
 *                   ambiente: `$aact_hmlg_` é homologação, `$aact_prod_` é
 *                   produção. `ambienteDaChave` deriva daí, e recusa o que não
 *                   reconhece — então a chave de homologação num Worker de
 *                   produção não "quase funciona": o cliente devolve `null`.
 *   clientSecret  → o TOKEN DO WEBHOOK, que confere o header
 *                   `asaas-access-token` em `/api/webhooks/asaas`. É o valor
 *                   definido por nós na configuração do webhook na Asaas, não
 *                   um segredo emitido por eles.
 *
 * A chave pertence a uma CONTA Asaas, e o prefixo `platform:` diz que é uma
 * conta para a plataforma inteira — por isso o mesmo par serve aos três apps
 * no MESMO ambiente, e nunca entre ambientes.
 */

/** A configuração guardada, ou `null` quando ninguém registrou a chave ainda. */
export async function asaasConfig(): Promise<AsaasConfig | null> {
    const creds = await getPlatformCredentials('asaas')
    if (!creds?.clientId) return null

    const ambiente = ambienteDaChave(creds.clientId)
    if (ambiente === 'desconhecido') {
        console.error('[ASAAS] chave guardada não começa com $aact_hmlg_ nem $aact_prod_')
        return null
    }

    return { chave: creds.clientId, ambiente, base: BASE[ambiente] }
}

/** O token que confere o header `asaas-access-token` dos webhooks. */
export async function asaasWebhookToken(): Promise<string | null> {
    const creds = await getPlatformCredentials('asaas')
    return creds?.clientSecret ?? null
}

export class AsaasError extends Error {
    constructor(
        readonly status: number,
        /** As descrições que o Asaas devolve em `errors[]`, já juntas. */
        readonly detalhe: string
    ) {
        super(`Asaas ${status}: ${detalhe}`)
    }
}

/**
 * Uma chamada à API do Asaas.
 *
 * `access_token` e não `Authorization: Bearer` — a documentação deles é
 * explícita, e o Bearer é o erro que todo mundo comete uma vez.
 *
 * Erro vira `AsaasError` com o texto que **eles** escreveram. Inventar uma
 * mensagem nossa aqui esconderia a única pessoa que sabe o motivo: "CPF/CNPJ
 * inválido" e "chave sem permissão" precisam chegar inteiros em quem lê o log.
 */
export async function asaas<T>(
    caminho: string,
    init: { method?: string; body?: unknown } = {}
): Promise<T> {
    const cfg = await asaasConfig()
    if (!cfg) throw new AsaasError(0, 'Asaas não configurado: registre a chave de API na plataforma.')

    const res = await fetch(`${cfg.base}${caminho}`, {
        method: init.method ?? 'GET',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': userAgent(),
            access_token: cfg.chave,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        /**
         * Sem `cache: 'no-store'`: o worker também chama isto, e o `RequestInit`
         * do Node não conhece a opção — ela é extensão do Next. Não faz falta:
         * desde o Next 15 o `fetch` não é cacheado por padrão, e aqui estamos em
         * rota e em worker, nunca em render de página.
         */
    })

    const texto = await res.text()
    const corpo = texto ? (JSON.parse(texto) as unknown) : null

    if (!res.ok) {
        const erros = (corpo as { errors?: { description?: string }[] } | null)?.errors
        const detalhe = erros?.map((e) => e.description).filter(Boolean).join('; ') || texto || 'sem detalhe'
        throw new AsaasError(res.status, detalhe)
    }

    return corpo as T
}
