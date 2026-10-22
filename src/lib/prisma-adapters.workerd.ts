import { PrismaNeon } from '@prisma/adapter-neon'

/**
 * A escolha do driver adapter — **versão Worker**, só Neon.
 *
 * Mesma assinatura de `prisma-adapters.ts`, e o `vite.config.ts` aponta para
 * cá nos ambientes `rsc` e `ssr`. A diferença é o que NÃO está aqui: nenhum
 * `import` de `@prisma/adapter-pg`, e portanto nenhuma biblioteca `pg` no
 * bundle. Era ela que impedia o Worker de iniciar — ver o cabeçalho do arquivo
 * irmão.
 *
 * **`ehNeon` continua existindo, e não é cerimônia.** No Worker a URL deveria
 * ser sempre do Neon, mas "deveria" não é garantia: um segredo trocado por
 * engano aponta para outro host, e sem esta checagem o `PrismaNeon` tentaria
 * falar o protocolo do Neon com um Postgres comum. O erro sairia como falha de
 * conexão genérica, longe da causa.
 *
 * Aqui a resposta é recusar alto, no momento da criação do cliente, dizendo
 * exatamente o que está errado.
 */

/** Se a URL aponta para o Neon. */
export function ehNeon(url: string): boolean {
    try {
        return new URL(url).hostname.endsWith('.neon.tech')
    } catch {
        return false
    }
}

export function criarAdapter(url: string, schema?: string) {
    if (!ehNeon(url)) {
        let host: string
        try {
            host = new URL(url).hostname
        } catch {
            host = '(URL malformada)'
        }

        throw new Error(
            `DATABASE_URL aponta para "${host}", que não é do Neon, e este build é o do ` +
                'Worker — onde só o driver do Neon existe. O driver de Postgres comum ' +
                'fica fora do bundle de propósito: a biblioteca `pg` impede o Worker de ' +
                'iniciar. Confira o segredo DATABASE_URL do Worker.'
        )
    }

    return new PrismaNeon({ connectionString: url }, schema ? { schema } : undefined)
}
