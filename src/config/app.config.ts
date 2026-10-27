import 'server-only'

import { z } from 'zod'

import { BRAND } from './brand'

/**
 * Configuração do app POR AMBIENTE — montada de env/vars, validada por zod.
 *
 * **Fallback-safe por desenho:** todo campo cai no comportamento ATUAL da
 * OdontoBox quando a variável não está setada. Mergear e até deployar este
 * arquivo não muda nada enquanto as novas vars (`APP_SLUG`, `APP_ENV`, …) não
 * forem gravadas — e elas só são gravadas no passo de ativação em produção, que
 * é o portão "OK produção" (ver Fase 03, "ordem crítica").
 *
 * Em particular `slug`/`env` ficam vazios por padrão; a trava de runtime (T3)
 * só liga quando os DOIS estão presentes. Enquanto vazios, a trava é no-op.
 */

const schema = z.object({
    /** Identidade do app para as travas. Vazio = trava inerte (comportamento atual). */
    slug: z.string().default(''),
    env: z.enum(['production', 'stg', '']).default(''),

    name: z.string().default(BRAND.name),
    url: z.string().url().default('https://odontobox.venn360.com'),

    emailFrom: z.string().default('noreply@mail.venn360.com'),
    emailFromName: z.string().default(BRAND.name),
    supportEmail: z.string().default('contato@venn360.com'),

    /** Base pública do Evolution (host do Tunnel). */
    evolutionBaseUrl: z.string().default(process.env.EVOLUTION_GO_URL ?? ''),

    /** Vazio = usa o default da lib (hoje `better-auth`), preservando sessões. */
    authCookiePrefix: z.string().default(''),
    trustedOrigins: z.array(z.string()).default([]),

    /** Só staging: destinos liberados para envio real; fora da lista, loga e descarta. */
    outboundAllowlist: z.array(z.string()).default([]),
    simulateExternal: z.boolean().default(false),

    /** Token do endpoint de identidade (T4). Vazio = endpoint recusa (503/401). */
    identityToken: z.string().default(''),

    /**
     * Flags de módulo por segmento. Os novos apps podem desligar sem apagar
     * código; na OdontoBox tudo fica ligado (comportamento atual).
     */
    features: z
        .object({
            odontograma: z.boolean().default(true),
        })
        .default({ odontograma: true }),
})

function csv(v: string | undefined): string[] {
    return (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
}

export type AppConfig = z.infer<typeof schema>

export const APP: AppConfig = schema.parse({
    slug: process.env.APP_SLUG,
    env: process.env.APP_ENV,
    name: process.env.APP_NAME,
    url: process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL,
    emailFrom: process.env.EMAIL_FROM,
    emailFromName: process.env.EMAIL_FROM_NAME,
    supportEmail: process.env.SUPPORT_EMAIL ?? process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    evolutionBaseUrl: process.env.EVOLUTION_BASE_URL ?? process.env.EVOLUTION_GO_URL,
    authCookiePrefix: process.env.AUTH_COOKIE_PREFIX,
    trustedOrigins: process.env.TRUSTED_ORIGINS ? csv(process.env.TRUSTED_ORIGINS) : undefined,
    outboundAllowlist: process.env.OUTBOUND_ALLOWLIST ? csv(process.env.OUTBOUND_ALLOWLIST) : undefined,
    simulateExternal: process.env.SIMULATE_EXTERNAL === 'true' ? true : undefined,
    identityToken: process.env.IDENTITY_TOKEN,
    features: undefined,
})

/** A trava de identidade só opera quando slug E env estão definidos. */
export const identidadeConfigurada = APP.slug !== '' && APP.env !== ''
