import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * A escolha do driver adapter — **versão Node**, com os dois drivers.
 *
 * Este módulo existe por uma razão só, e ela é de empacotamento: a variante
 * `prisma-adapters.workerd.ts` traz **apenas** o Neon, e o `vite.config.ts`
 * aponta para ela nos ambientes do Worker.
 *
 * **Por que separar.** Medido em 2026-10-21: com os dois `import` estáticos no
 * mesmo arquivo, o bundle do Worker levava `@prisma/adapter-pg` e, com ele, a
 * biblioteca `pg` — que executa código de Node na carga do módulo e impede o
 * Worker de iniciar:
 *
 *     [code: 10021] validation error
 *       at node_modules/pg/lib/index.js:25
 *       at node_modules/@prisma/adapter-pg/dist/index.mjs:3
 *
 * E não dava para resolver de dentro: `import()` dinâmico tornaria a criação do
 * cliente assíncrona, e `prisma.ts` entrega os delegates por um `Proxy`
 * **síncrono** (`prisma.user.findMany()` é acesso a propriedade). Marcar como
 * `external` também não serve: workerd falharia ao resolver o especificador na
 * carga.
 *
 * Os dois drivers continuam necessários, em destinos diferentes:
 *
 *   - Worker (Cloudflare): a URL é sempre `*.neon.tech` → só `PrismaNeon`;
 *   - contêiner da VPS: Postgres comum auto-hospedado → `PrismaPg`.
 *
 * Então apagar o `PrismaPg` quebraria a produção que está no ar hoje.
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
    return ehNeon(url)
        ? new PrismaNeon({ connectionString: url }, schema ? { schema } : undefined)
        : new PrismaPg({ connectionString: url }, schema ? { schema } : undefined)
}
