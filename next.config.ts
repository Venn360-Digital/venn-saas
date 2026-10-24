import type { NextConfig } from "next";

/**
 * Os cabeçalhos de segurança da resposta.
 *
 * Não existiam: a auditoria de 2026-10-23 achou `next.config.ts` sem `headers()`
 * nenhum — sem CSP, sem HSTS, sem `X-Content-Type-Options`, sem
 * `Referrer-Policy` e sem controle de enquadramento, num app que renderiza nome
 * e telefone de paciente.
 *
 * ## Cada diretiva saiu de uma medição, não de uma lista de boas práticas
 *
 * - **`script-src`**: nenhum script externo em `src/` — a varredura por
 *   `fetch('https://…')` no cliente devolveu vazio, e não há `<script src>` de
 *   terceiro. O `'unsafe-inline'` é pelo bootstrap do App Router, e é a
 *   fraqueza conhecida deste conjunto: ver a nota no fim.
 * - **`style-src`**: `'unsafe-inline'` pelo Tailwind com valor arbitrário e
 *   pelos atributos `style` do Radix.
 * - **`font-src 'self'`**: as fontes vêm de `next/font/google`, que as
 *   **auto-hospeda em tempo de build** — não há requisição a
 *   `fonts.gstatic.com` em runtime.
 * - **`img-src`** inclui o endpoint do R2 porque `PUBLIC_STORAGE_BASE_URL`
 *   **não está declarada** em `cloudflare.config.ts`: sem ela, `enderecoPara()`
 *   degrada o arquivo público para URL assinada no endpoint S3
 *   (`<conta>.r2cloudflarestorage.com`), e é dali que o avatar e a mídia da
 *   conversa carregam hoje. Se um domínio público for configurado, ele entra
 *   aqui também.
 * - **`connect-src 'self'`** cobre a API e o WebSocket: `lib/realtime/cliente.ts`
 *   monta a URL com `location.host`, então o tempo real é mesma origem.
 * - **`frame-ancestors 'none'`** é seguro porque o widget **não usa iframe** —
 *   ele injeta Shadow DOM na página da clínica (`app/widget.js/route.ts`).
 *   Enquadrar a aplicação nunca foi um caso de uso.
 *
 * ## `object-src`, `base-uri` e `form-action` valem mesmo com `unsafe-inline`
 *
 * São as três que continuam agindo quando o script inline é permitido:
 * bloqueiam plugin, impedem reescrever a base dos links relativos, e impedem um
 * formulário da nossa página postar para fora.
 *
 * ## HSTS sem `preload`, de propósito
 *
 * `preload` entra numa lista embutida nos navegadores e **sair dela leva
 * meses**. Um ano de `max-age` já obriga HTTPS para quem visitou; o `preload`
 * fica para quando o domínio estiver estável.
 *
 * ## O que este conjunto NÃO resolve
 *
 * `'unsafe-inline'` em `script-src` tira do CSP a proteção contra XSS, que é o
 * motivo principal de existir um. O caminho é nonce por requisição, e o App
 * Router o suporta via middleware — este projeto já tem o portão em
 * `src/proxy.ts`, que é onde ele entraria. Não foi feito aqui porque é mudança
 * de outra natureza e exige propagar o nonce. O que este conjunto dá hoje:
 * nenhum script de origem externa executa, nenhum formulário posta para fora,
 * a página não é enquadrável, e o `Referrer-Policy` para de vazar o caminho
 * (que carrega id de paciente) para terceiros.
 *
 * A auditoria, com isto, registra o item como parcialmente fechado — não como
 * resolvido.
 */
const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com",
    "connect-src 'self' https://*.r2.cloudflarestorage.com",
    "media-src 'self' blob: https://*.r2.cloudflarestorage.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
].join('; ')

const CABECALHOS = [
    { key: 'Content-Security-Policy', value: CSP },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
        /**
         * O que a clínica não precisa — e **`microphone` ela precisa**.
         *
         * A versão de 2026-10-24 trazia `microphone=()`, que não é "ninguém de
         * fora": é **ninguém, inclusive nós**. Isso desligou a gravação de nota
         * de voz do atendente (`atendimento/conversas/page.tsx:1563`,
         * `getUserMedia({ audio: true })`) no app inteiro.
         *
         * Nenhum dos nove verificadores enxerga isso, e a verificação de
         * navegador que eu fiz cobriu só a tela de login — a única alcançável
         * sem sessão. O recurso ficou quebrado em produção por horas, e só não
         * foi notado porque ninguém tentou gravar.
         *
         * `self` é o que se quer dizer: a nossa origem pode, mais ninguém —
         * nem um iframe de terceiro, nem um script injetado.
         *
         * `camera`, `geolocation`, `payment` e `usb` seguem em `()` porque o
         * código **não os usa**, e isso foi conferido por varredura, não
         * suposto: sem `capture=`, sem `facingMode`, sem `video: true`, sem
         * `PaymentRequest`. Se algum dia um deles entrar, esta linha é que
         * reprova — e é aqui que se descobre por quê.
         */
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()',
    },
]

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
  async headers() {
    return [
      {
        /**
         * Todas as rotas, inclusive as da API.
         *
         * O CSP não faz diferença numa resposta JSON, mas `nosniff` e
         * `Referrer-Policy` fazem — e um `source` seletivo criaria a pergunta
         * "esta rota está coberta?" a cada rota nova.
         */
        source: '/:path*',
        headers: CABECALHOS,
      },
    ]
  },
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
