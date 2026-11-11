/**
 * Apaga os tipos que o Next GERA, antes de qualquer typecheck.
 *
 *     node scripts/limpar-tipos-gerados.mjs
 *
 * ## O defeito que isto existe para evitar
 *
 * O `tsconfig.json` inclui `.next/types/**` e `.next/dev/types/**` de
 * propósito: é lá que o Next emite o validador de rotas, e ele pega assinatura
 * errada de `page.tsx` e de route handler. Mas são arquivos **gerados**, e
 * quem os gera não é mais um só:
 *
 * - `next build` e `next dev` emitem `routes.d.ts` **e** `validator.ts`;
 * - o `vite build` do vinext — que é o build que de fato publicamos — emite um
 *   `routes.d.ts` com outra forma, e não emite `validator.ts`.
 *
 * Medido em 2026-11-11 neste worktree: um `validator.ts` de 09/11 (de um
 * `next dev`) importava `AppRoutes`, `LayoutRoutes`, `ParamMap` e
 * `AppRouteHandlerRoutes` de `./routes.js`; o `vite build` daquela manhã
 * regravou `routes.d.ts` com **um** export, nenhum deles. `tsc --noEmit` passou
 * a falhar em quatro linhas, e nenhuma delas era código nosso.
 *
 * Isso é veneno num portão de deploy. O typecheck do `preportao:*` roda
 * **depois** do build (o deploy command vem depois do build command), então
 * ele herda o que o vinext escreveu ali — e reprovaria o deploy por lixo de
 * geração, com uma mensagem que manda procurar defeito onde não há.
 *
 * ## Por que apagar, e não excluir do tsconfig
 *
 * Excluir mataria a verificação de rotas também no caminho onde ela funciona
 * (`npm run build`, que é `next build` e regenera os dois arquivos
 * coerentes logo depois deste script). Apagar mantém a cobertura onde ela é
 * válida e tira o estado inconsistente onde não é: o que o Next precisar, ele
 * gera de novo; o que ficou órfão, não volta.
 *
 * Nunca falha. Diretório que não existe é o caso normal — num checkout limpo do
 * CI não há `.next` nenhum.
 */
import { rmSync } from 'node:fs'

const GERADOS = ['.next/types', '.next/dev/types']

for (const caminho of GERADOS) {
    // `force` engole ENOENT: num runner de CI o `.next` não existe, e isso não
    // é erro — é o estado desejado.
    rmSync(caminho, { recursive: true, force: true })
}

console.log(`tipos gerados limpos (${GERADOS.join(', ')})`)
