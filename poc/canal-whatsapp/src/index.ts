/// <reference types="@cloudflare/workers-types" />
import { getContainer } from '@cloudflare/containers'
import { CanalWhatsApp, type Ambiente } from './canal'

export { CanalWhatsApp }

/**
 * Worker da POC do Evolution Go em Cloudflare Containers.
 *
 * Deliberadamente separado do Worker da aplicação: a POC pode falhar, ser
 * republicada e ser apagada sem tocar na migração. Se o resultado for bom, o
 * que migra é a classe `CanalWhatsApp`, não este arquivo.
 *
 * Tudo atrás de `POC_TOKEN`. A URL `*.workers.dev` é pública e o que está do
 * outro lado é um Evolution Go com chave global — um endpoint aberto aqui
 * entregaria a capacidade de criar instância e parear número.
 */

function semAutorizacao(): Response {
    // Sem corpo e sem dica de qual parte falhou.
    return new Response('não encontrado', { status: 404 })
}

/** Comparação de tempo constante, para o token não vazar por cronometragem. */
function iguais(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diferenca = 0
    for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diferenca === 0
}

const PAGINA = (workspace: string, token: string) => `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>POC Evolution Go — ${workspace}</title>
<style>
  body{font:15px/1.6 system-ui,sans-serif;max-width:46rem;margin:3rem auto;padding:0 1.5rem;color:#111}
  h1{font-size:1.3rem;margin:0 0 .25rem}p{color:#555}
  button{font:inherit;padding:.6rem 1.1rem;border:1px solid #111;background:#111;color:#fff;border-radius:6px;cursor:pointer}
  button:disabled{opacity:.5;cursor:wait}
  img{image-rendering:pixelated;width:17rem;height:17rem;border:1px solid #ddd;margin:1.25rem 0}
  pre{background:#f6f6f6;padding:.9rem;border-radius:6px;overflow:auto;font-size:12.5px;line-height:1.5}
  .nota{font-size:13px;color:#777;border-left:3px solid #ddd;padding-left:.9rem}
</style>
<h1>POC — Evolution Go em Cloudflare Containers</h1>
<p>Workspace <code>${workspace}</code></p>
<p class="nota">O contêiner sobe na primeira chamada e pode levar algum tempo na
primeira vez, enquanto a imagem é provisionada. Depois de ler o QR, esta página
passa a mostrar o diário do contêiner — é onde o reinício pós-pareamento
aparece.</p>
<button id="b">Gerar QR</button>
<div id="qr"></div>
<pre id="d">—</pre>
<script>
const ws = ${JSON.stringify(workspace)}
const CAB = { 'x-poc-token': ${JSON.stringify(token)} }
const b = document.getElementById('b')
b.onclick = async () => {
  b.disabled = true; b.textContent = 'subindo o contêiner…'
  try {
    const r = await fetch('/pareie/' + ws, { method: 'POST', headers: CAB })
    const j = await r.json()
    document.getElementById('qr').innerHTML = j.qrcode
      ? '<img src="' + j.qrcode + '" alt="QR">'
      : '<p>sem QR: ' + JSON.stringify(j) + '</p>'
  } catch (e) { document.getElementById('qr').textContent = String(e) }
  b.disabled = false; b.textContent = 'Gerar outro QR'
}
async function girar() {
  try {
    const [e, d] = await Promise.all([
      fetch('/estado/' + ws, { headers: CAB }).then(r => r.json()),
      fetch('/diario/' + ws, { headers: CAB }).then(r => r.json()),
    ])
    document.getElementById('d').textContent =
      JSON.stringify(e, null, 2) + '\\n\\n--- diário ---\\n' +
      d.slice(-25).map(l => l.em.slice(11, 19) + '  ' + l.o_que + (l.detalhe ? '  — ' + l.detalhe : '')).join('\\n')
  } catch {}
}
girar(); setInterval(girar, 4000)
</script>`

export default {
    async fetch(pedido: Request, env: Ambiente, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(pedido.url)
        const partes = url.pathname.split('/').filter(Boolean)

        // ---------------------------------------------------- webhook de entrada
        //
        // Primeiro, porque é o único caminho cuja autorização vem do próprio
        // caminho: o Evolution Go não assina os webhooks que emite.
        if (partes[0] === 'entrada') {
            const [, token, idDoCanal] = partes
            if (!token || !iguais(token, env.POC_TOKEN) || !idDoCanal) return semAutorizacao()

            const corpo = (await pedido.json().catch(() => ({}))) as { event?: string }
            const evento = corpo.event ?? 'desconhecido'
            console.log(`[entrada] ${idDoCanal.slice(0, 8)} ${evento}`)

            // É aqui que o contorno começa — e é a diferença de fundo entre esta
            // arquitetura e a VPS. Lá, descobrir o pareamento exigia um daemon
            // lendo `docker logs -f` e chamando `docker restart`, com o socket do
            // Docker exposto. Aqui o evento já chega pela porta da frente, e a
            // autoridade para reiniciar é a do próprio objeto sobre o seu
            // contêiner.
            if (evento === 'PairSuccess') {
                const canal = env.CANAL.get(env.CANAL.idFromString(idDoCanal))
                ctx.waitUntil(
                    canal
                        .fetch(new Request('http://canal/poc/pareou', { method: 'POST' }))
                        .then(() => undefined)
                        .catch((erro) => console.error('[entrada] falha ao abrir a janela', erro))
                )
            }

            // Sempre 200: webhook que devolve erro vira repetição do provedor, e
            // a POC não ganha nada com isso.
            return Response.json({ ok: true })
        }

        // ------------------------------------------------------- tudo o mais
        //
        // Três origens para o token, e a terceira existe por um motivo
        // concreto: a ativação da licença do Evolution Go é feita por uma
        // pessoa no `/manager`, e navegador não manda cabeçalho em subrecurso
        // (CSS, script, XHR da própria página do manager). Então o token entra
        // uma vez por `?t=` e passa a viajar em cookie.
        const doCookie = (pedido.headers.get('cookie') ?? '').match(/(?:^|;\s*)poc=([^;]+)/)?.[1] ?? ''
        const daBarra = url.searchParams.get('t') ?? ''
        const token = pedido.headers.get('x-poc-token') ?? daBarra ?? doCookie
        const valido = (v: string) => Boolean(v) && Boolean(env.POC_TOKEN) && iguais(v, env.POC_TOKEN)
        if (!valido(token) && !valido(doCookie)) return semAutorizacao()

        // HttpOnly e SameSite=Lax: não há JS que precise lê-lo, e não há
        // navegação de terceiro que deva carregá-lo.
        const biscoito: Record<string, string> = valido(daBarra)
            ? { 'set-cookie': `poc=${daBarra}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400` }
            : {}

        const ROTAS_DA_POC = ['pagina', 'pareie', 'estado', 'diario'] as const
        const [rota = '', workspace] = partes

        if (ROTAS_DA_POC.includes(rota as (typeof ROTAS_DA_POC)[number]) && !workspace) {
            return new Response(`falta o workspace: /${rota}/<workspace>?t=…`, { status: 400 })
        }

        // Um objeto por workspace, endereçado pelo nome — é o que garante que a
        // sessão de um cliente nunca cai no contêiner de outro.
        // Já garantido acima para as rotas da POC; o padrão serve ao `/manager`.
        const ws = workspace ?? 'poc-1'
        const canal = getContainer(env.CANAL, ws)

        switch (rota) {
            case 'pagina':
                return new Response(PAGINA(ws, token), {
                    headers: { 'content-type': 'text/html; charset=utf-8', ...biscoito },
                })

            case 'pareie':
                return canal.fetch(new Request('http://canal/poc/pareie', { method: 'POST' }))

            case 'estado':
                return canal.fetch(new Request('http://canal/poc/estado'))

            case 'diario':
                return canal.fetch(new Request('http://canal/poc/diario'))

            default: {
                // Tudo o que não é rota da POC vai para o Evolution Go.
                //
                // Existe por uma necessidade concreta: a licença é ativada por
                // uma pessoa no `/manager`, que é uma aplicação web inteira —
                // precisa de `/assets/*`, de `/vite.svg` e das chamadas que o
                // próprio painel faz, cujos caminhos não estão documentados.
                // Enumerar essa lista por tentativa seria adivinhação; o que
                // dá para afirmar é o que está do outro lado.
                //
                // ⚠️ Isto é da POC e **não pode** ir para produção: expõe a API
                // administrativa do Evolution Go inteira atrás de um token só.
                // No desenho definitivo o `/manager` não é publicado — a
                // ativação é um ato único, e depois disso ninguém precisa dele.
                //
                // O workspace vem de `?ws=`, com `poc-1` como padrão, porque a
                // ativação fica no Postgres compartilhado: ativar num contêiner
                // vale para todos.
                const alvoWs = url.searchParams.get('ws') ?? 'poc-1'
                const interno = new URL(pedido.url)
                interno.searchParams.delete('t')
                interno.searchParams.delete('ws')

                const r = await getContainer(env.CANAL, alvoWs).fetch(new Request(interno.toString(), pedido))
                if (Object.keys(biscoito).length === 0) return r

                const cabecalhos = new Headers(r.headers)
                for (const [k, v] of Object.entries(biscoito)) cabecalhos.append(k, v)
                return new Response(r.body, { status: r.status, headers: cabecalhos })
            }
        }
    },
}
