import { BRAND } from '@/config/brand'

/**
 * O `robots.txt`, em texto cru — e é por isso que é uma rota, não `app/robots.ts`.
 *
 * O helper `robots.ts` do Next monta o arquivo a partir de um objeto, e o
 * vocabulário dele não tem `Content-Signal`: o que ele não conhece, ele não
 * emite. Como a diretiva é justamente o motivo deste arquivo existir, o texto é
 * escrito à mão.
 *
 * **Antes disto, `/robots.txt` respondia 307 para `/login`.** Não era redirect
 * engolindo o arquivo — o arquivo não existia, e o portão de autenticação
 * (`lib/auth/middleware.ts`) trata tudo que não está na lista de caminhos
 * públicos como tela a proteger. Um crawler pedia o robots e recebia um convite
 * para entrar na conta.
 *
 * **O que se declara aqui, e por quê.** A casa libera busca, resposta de IA e
 * treinamento — decisão do André, válida para todos os projetos. É o oposto do
 * padrão da Cloudflare, que recusa treinamento, então em zona nova tem de ser
 * desfeito de propósito. A borda desta zona já está conferida:
 * `ai_bots_protection`, `crawler_protection` e `ai_training` estão `disabled`.
 * Se a borda barrasse, este arquivo seria irrelevante — o bot não chegaria aqui
 * para lê-lo.
 *
 * **Não há `Sitemap:`** porque não há sitemap, e apontar para um que não existe
 * é pior que omitir. O produto vive atrás de autenticação: o que um crawler
 * alcança é a tela de entrada e a política de privacidade. O `Allow: /` não
 * abre nada além disso — as rotas protegidas continuam respondendo com o
 * redirect do portão.
 */
export const dynamic = 'force-static'

export function GET(): Response {
    const corpo = [
        `# ${BRAND.name}`,
        '#',
        '# O produto fica atrás de autenticação, então não há catálogo a indexar.',
        '# A política mesmo assim é declarada, e é de porta aberta: busca,',
        '# resposta de IA e treinamento, todos permitidos.',
        '',
        'User-agent: *',
        'Content-Signal: search=yes, ai-input=yes, ai-train=yes',
        'Allow: /',
        '',
    ].join('\n')

    return new Response(corpo, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            // Um dia. Não muda com frequência, e um crawler que o releia a cada
            // visita gasta requisição à toa.
            'Cache-Control': 'public, max-age=86400',
        },
    })
}
