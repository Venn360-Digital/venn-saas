/**
 * Substituto vazio de `@prisma/adapter-pg`, só para o bundle do Worker.
 *
 * **Por que existe.** A biblioteca `pg`, que o adapter importa, executa código
 * de Node na carga do módulo e impede o Worker de iniciar:
 *
 *     [10021] Uncaught TypeError: Class extends value #<Object> is not a constructor
 *       at poolFactory (node_modules/pg/lib/index.js:14)
 *       at node_modules/@prisma/adapter-pg/dist/index.mjs:3
 *
 * E o problema é a CARGA, não o uso: no Worker esse driver nunca é chamado,
 * porque a URL é sempre do Neon. Bastava ele não estar no bundle.
 *
 * **Por que um shim e não as alternativas.** Tentadas, nesta ordem:
 *
 *   1. dois módulos e alias de `../prisma-adapters` por ambiente — o alias
 *      não pegou; o `@/` do vinext resolve antes e meu alias nunca via o
 *      especificador;
 *   2. `import()` dinâmico — tornaria a criação do cliente assíncrona, e
 *      `prisma.ts` entrega os delegates por um `Proxy` síncrono;
 *   3. `external` — workerd falharia ao resolver o especificador na carga;
 *   4. apagar o `PrismaPg` — quebraria a VPS, que usa Postgres comum.
 *
 * Alias de especificador **bare** funciona porque não passa pela resolução do
 * `@/`. É o mesmo padrão que o `workers/tsup.config.ts` já usa para trocar
 * `server-only` por um shim.
 *
 * **Lançar e não devolver `null`:** se algum dia este construtor for chamado
 * dentro do Worker, significa que a `DATABASE_URL` deixou de ser do Neon. Falhar
 * aqui nomeia a causa; devolver algo vazio produziria erro de conexão genérico,
 * longe dela.
 */

export class PrismaPg {
    constructor() {
        throw new Error(
            'PrismaPg foi construído dentro do Worker, onde ele não existe: o driver de ' +
                'Postgres comum fica fora do bundle porque a lib `pg` impede o Worker de ' +
                'iniciar. Isto só acontece se DATABASE_URL não for do Neon — confira o ' +
                'segredo do Worker. Ver src/lib/shims/adapter-pg-vazio.ts.'
        )
    }
}
