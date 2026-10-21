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

  environments: {
    rsc: { resolve: { conditions: CONDICOES_DO_WORKER } },
    ssr: { resolve: { conditions: CONDICOES_DO_WORKER } },
  },
});
