import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  /**
   * As regras do React Compiler, em aviso e não em erro — por ora.
   *
   * O `eslint-config-next` 16.4 (atualizado na auditoria de segurança de
   * 2026-10-21, para fechar dois RCE críticos) passou a ligar os diagnósticos do
   * React Compiler. Eles apontam **52 padrões pré-existentes** no React do app:
   * 38 `setState` dentro de efeito, 10 de imutabilidade, e alguns de pureza e
   * refs.
   *
   * Nada disso nasceu da atualização nem da migração; o que mudou foi o linter
   * passar a ver. E nada disso é defeito de segurança — são padrões que causam
   * renderização em cascata e memoização perdida.
   *
   * **Por que aviso e não erro.** Consertar os 38 é refator de interface com
   * risco próprio, em telas que hoje funcionam, e não cabe num commit de
   * segurança. Mas deixar o `eslint` vermelho seria pior: um portão que está
   * sempre quebrado deixa de ser portão, e o próximo erro de verdade passaria
   * no meio do ruído.
   *
   * Em aviso eles continuam visíveis e contáveis, e o gate volta a significar
   * algo. Tarefa própria para voltar a erro, uma regra por vez.
   */
  {
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    // `**/` à frente porque no monorepo o `.next` nasce em `apps/<app>/`, e o
    // padrão do preset é ancorado na raiz. Sem isso, um `next build` local faz
    // o lint varrer a saída de build: 23.657 problemas em chunks gerados,
    // dos quais 2.047 "erros" — e o passo reprova por nada.
    "**/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build artefacts and vendored infrastructure.
    "workers/dist/**",
    // Cópias do repositório que as worktrees do Claude deixam DENTRO dele.
    // Sem esta linha o eslint entra nelas e linta o projeto várias vezes —
    // 2338 "erros" na última medição, todos de código que já passou, e que
    // mascaravam os erros reais. O CI faz checkout limpo e nunca viu isso, o
    // que fazia o lint local e o do portão discordarem; com a linha, o local
    // dá exatamente os 189 avisos e 0 erros que o build do Worker dá.
    ".claude/**",
    // Cliente do Prisma, gerado. Mudou de lugar na Fase 2 do monorepo
    // (era `src/generated/`), e o ignore tem de acompanhar.
    "packages/db/src/generated/**",
  ]),
]);

export default eslintConfig;
