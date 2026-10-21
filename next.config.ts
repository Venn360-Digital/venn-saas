import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Dois destinos querem valores OPOSTOS aqui, e por isso é condicional.
   *
   * VPS (padrão): `standalone` emite um servidor autocontido em
   * `.next/standalone`, que é o que o `Dockerfile:91` copia em vez da árvore
   * inteira de `node_modules`. A produção no ar depende disso.
   *
   * Cloudflare: `standalone` tem de estar DESLIGADO. O vinext lê este campo e,
   * ao ver "standalone", roda o próprio passo standalone dele, que procura a
   * saída em `dist/` — enquanto o `@cloudflare/vite-plugin` escreve em
   * `.cloudflare/output/`. O build quebrava no fim, depois de ter compilado
   * tudo, com "No build output found in …/dist. Run vite build first."
   *
   * O padrão é o da VPS de propósito: enquanto ela é a produção, esquecer a
   * variável não pode quebrá-la. Os scripts `*:vinext` definem BUILD_TARGET.
   */
  output: process.env.BUILD_TARGET === "cloudflare" ? undefined : "standalone",
  serverExternalPackages: [
    '@langchain/openai',
    '@langchain/textsplitters',
    // `@langchain/core` continua aqui: ele não é importado direto, mas é peer
    // dos dois acima e faz require dinâmico que o bundler quebra. `langchain` e
    // `@langchain/community` saíram da lista porque saíram do projeto — estavam
    // declarados e nunca importados, e eram eles que traziam o handlebars com
    // duas falhas críticas. Ver `docs/migration/10-auditoria-de-seguranca.md`.
    '@langchain/core',
    // Keeps BullMQ and ioredis out of the bundler: both resolve Lua scripts and
    // native bits at runtime.
    'bullmq',
    'ioredis',
  ],
  // Empty turbopack config to silence warning
  turbopack: {},
  async redirects() {
    return [
      {
        // A tela de pacientes morava em /vendas/contatos até 2026-10-08, quando
        // "contato" saiu do vocabulário do produto. Permanente porque o destino
        // é definitivo, e aqui — e não numa página de redirecionamento — para
        // resolver antes do roteamento, sem renderizar nada no caminho.
        source: '/vendas/contatos',
        destination: '/vendas/pacientes',
        permanent: true,
      },
      {
        // E a de procedimentos morava em /vendas/servicos até 2026-10-20.
        // Mesma razão: "serviço" era a palavra de software, e a clínica chama
        // de procedimento. Link guardado continua chegando.
        source: '/vendas/servicos',
        destination: '/vendas/procedimentos',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
