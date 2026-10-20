import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle under .next/standalone, which is what
  // the Docker runtime stage copies instead of the whole node_modules tree.
  output: "standalone",
  serverExternalPackages: [
    '@langchain/openai',
    '@langchain/textsplitters',
    '@langchain/community',
    '@langchain/core',
    'langchain',
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
