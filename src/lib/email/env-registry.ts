/**
 * Registro global de `env` para Email Sending.
 *
 * Similar ao padrão de `src/cloudflare/costuras.ts`: o `env` é necessário
 * apenas dentro do binding de Email, mas a função `sendEmail` é chamada de
 * contextos que não têm acesso direto a ele (como funções de negócio).
 *
 * **Guardar o `env` aqui é seguro.** O binding `EMAIL` não é derivado dele:
 * é o próprio binding, que a plataforma substitui junto com o isolate quando
 * apenas os bindings mudam. O padrão é o mesmo em costuras.ts.
 */

export interface EmailEnvRegistry {
    EMAIL: any
    EMAIL_FROM: string
    EMAIL_RATELIMIT: any
    CF_CONNECTING_IP?: string
}

let registrado: EmailEnvRegistry | null = null

export function registrarEmailEnv(env: EmailEnvRegistry): void {
    registrado = env
}

export function obterEmailEnv(): EmailEnvRegistry {
    if (!registrado) {
        throw new Error('Email environment not registered. Call registrarEmailEnv first.')
    }
    return registrado
}
