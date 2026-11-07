import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

/**
 * As condições de resolução dos ambientes do Worker — e `node` NÃO está aqui.
 *
 * Medido em 2026-10-21, no primeiro deploy: toda consulta ao banco falhava com
 * `PrismaClientInitializationError`, e `/api/health` respondia
 * `{"checks":{"database":"error"}}`.
 *
 * A causa é a ORDEM DO MAPA DE EXPORTS do client gerado pelo Prisma:
 *
 *   "require": { "node": "./index.js", "edge-light": "./wasm.js",
 *                "workerd": "./wasm.js", ... }
 *
 * Resolução de export map percorre as chaves na ordem em que ELAS aparecem, não
 * na ordem do consumidor. Com `node` primeiro, basta o bundler ter `node` entre
 * suas condições para `index.js` ganhar — e `index.js` é o build que procura o
 * engine nativo (`libquery_engine-*.node`). Workers não carrega binário, então
 * a inicialização morre antes de qualquer SQL.
 *
 * Acrescentar `workerd` não resolveria: é preciso **tirar `node`**. Com ele
 * fora, a primeira chave que casa é `workerd`, que aponta para `wasm.js` — o
 * engine wasm, que aceita driver adapter.
 *
 * Por que não `@prisma/client/edge`: o próprio Prisma recusa a combinação —
 * "configured to use the `adapter` option but it was imported via its `/edge`
 * endpoint". `/edge` é o caminho do Accelerate, e é mutuamente exclusivo com
 * driver adapter. Tentado e descartado na mesma sessão.
 *
 * `browser` também fica fora de propósito: ele faria outras dependências cair
 * em build de navegador, que não é o que roda num Worker.
 */
const CONDICOES_DO_WORKER = ["workerd", "worker", "module", "import", "default"];

/**
 * O driver de Postgres comum fica FORA do bundle do Worker.
 *
 * Medido em 2026-10-21, depois de corrigir as condições acima: o deploy passou
 * a falhar antes de o Worker subir, com
 *
 *     [code: 10021] validation error
 *       at node_modules/pg/lib/index.js:25
 *       at node_modules/@prisma/adapter-pg/dist/index.mjs:3
 *
 * `src/lib/prisma.ts` serve aos DOIS destinos e precisava dos dois drivers — o
 * Worker fala com o Neon, e o Evolution Go na Vultr com o Postgres dele
 * auto-hospedado. Com os dois `import` estáticos juntos, o bundle do Worker
 * levava a biblioteca `pg`, que executa código de Node na carga do módulo.
 *
 * Não havia saída de dentro do arquivo: `import()` dinâmico tornaria a criação
 * do cliente assíncrona, e `prisma.ts` entrega os delegates por um `Proxy`
 * síncrono; e marcar como `external` faria workerd falhar ao resolver o
 * especificador. Então a escolha do driver saiu para um módulo próprio, com
 * duas versões, e o bundler troca uma pela outra aqui.
 */
const RESOLVE_DO_WORKER = {
  conditions: CONDICOES_DO_WORKER,
};

export default defineConfig({
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],

  /**
   * Alias na RAIZ, e de especificador **bare** — as duas coisas de propósito.
   *
   * Na raiz porque este arquivo é lido **somente** pelo build da Cloudflare
   * (`build:vinext`). A VPS compila por `next build`, que lê o
   * `next.config.ts` e nunca este — então trocar o driver aqui não alcança a
   * produção que está no ar.
   *
   * Bare porque a tentativa anterior falhou: eu havia aliasado
   * `@/lib/prisma-adapters` no nível do ambiente, e não pegou — o `@` do vinext
   * resolve antes, e o alias nunca via o especificador. `@prisma/adapter-pg`
   * não passa por essa resolução.
   *
   * É o mesmo padrão que `workers/tsup.config.ts` já usa para trocar
   * `server-only` por um shim.
   */
  environments: {
    rsc: { resolve: RESOLVE_DO_WORKER },
    ssr: { resolve: RESOLVE_DO_WORKER },
  },
});
