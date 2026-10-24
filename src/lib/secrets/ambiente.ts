import 'server-only'

/**
 * Os segredos de plataforma, lidos do Cloudflare Secrets.
 *
 * Os cinco segredos que estavam no cofre da plataforma anterior são todos **globais**:
 * identificam os apps da Venn360 junto à Meta, ao Instagram e ao Asaas, e não
 * variam por clínica. Segredo global com valor fixo é configuração de implantação,
 * e o lugar dele é o cofre da plataforma de execução — não uma linha de banco.
 *
 * Medidos na VPS em 2026-10-21:
 *
 *     platform:asaas:clientId              → PLATFORM_ASAAS_CLIENT_ID
 *     platform:asaas:clientSecret          → PLATFORM_ASAAS_CLIENT_SECRET
 *     platform:instagram_login:clientSecret → PLATFORM_INSTAGRAM_LOGIN_CLIENT_SECRET
 *     platform:meta_messaging:clientSecret → PLATFORM_META_MESSAGING_CLIENT_SECRET
 *     platform:meta_messaging:verifyToken  → PLATFORM_META_MESSAGING_VERIFY_TOKEN
 *
 * **Por que `process.env` e não `import { env } from 'cloudflare:workers'`.**
 * O typecheck desta máquina não resolve `cloudflare:workers` — sem Miniflare
 * local, `.cloudflare/types` não é gerado. E secret de texto chega em
 * `process.env` tanto no Worker quanto no `next dev`, então um caminho só serve
 * aos dois ambientes. Binding de verdade (R2, Queue, Durable Object) é outra
 * história e aí o import é inevitável.
 */

/** Converte `platform:meta_messaging:clientSecret` em `PLATFORM_META_MESSAGING_CLIENT_SECRET`. */
export function nomeDeAmbiente(nomeDoSegredo: string): string {
    return nomeDoSegredo
        .split(':')
        // `clientSecret` → `client_Secret`, para que o upper case gere `CLIENT_SECRET`.
        .map((parte) => parte.replace(/([a-z0-9])([A-Z])/g, '$1_$2'))
        .join('_')
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_')
}

/**
 * O valor, se este segredo é definido no ambiente.
 *
 * Nulo quando não está definido — o que é diferente de estar definido vazio, e
 * por isso o `.trim()` descarta string em branco: um secret criado por engano
 * com valor vazio deve parecer ausente, não configurado.
 */
export function segredoDeAmbiente(nomeDoSegredo: string): string | null {
    const valor = process.env[nomeDeAmbiente(nomeDoSegredo)]?.trim()
    return valor ? valor : null
}

/** Se este segredo vem do ambiente — e, portanto, não é gravável pela aplicação. */
export function definidoNoAmbiente(nomeDoSegredo: string): boolean {
    return segredoDeAmbiente(nomeDoSegredo) !== null
}
