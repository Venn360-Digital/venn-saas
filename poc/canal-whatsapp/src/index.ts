/// <reference types="@cloudflare/workers-types" />
import { getContainer } from '@cloudflare/containers'
import { CanalWhatsApp, type Ambiente } from './canal'
import {
    CABECALHO,
    classificarRota,
    eventoDisparaReciclo,
    iguais,
    partesDaEntrada,
    salaValida,
} from './roteamento'

export { CanalWhatsApp }

/**
 * Worker do canal QR de WhatsApp (Evolution Go em Cloudflare Containers).
 *
 * Duas naturezas de tráfego, e só duas (ver `classificarRota`):
 *
 *  - **API** (`/instance/*`, `/message/*`, `/license/*`…): chega pelo **service
 *    binding** do app. Guardada por `x-evo-gateway` = a chave global, e roteada
 *    por `x-evo-sala` = o id da integração. Um contêiner por sala. Sem token de
 *    pessoa, sem URL pública da API — o binding é a fronteira.
 *  - **Webhook** (`/entrada/{segredo}/{sala}`): o Evolution Go posta aqui (não
 *    fala binding). Segredo no caminho porque ele não assina o que emite. O
 *    Worker dispara o reciclo pós-pareamento e **repassa o evento ao app**.
 *
 * O `/manager` e o SPA de ativação saíram: a licença se ativa pelo servidor
 * (`GET /license/activate?code=…`), e publicar a API administrativa atrás de um
 * proxy de cookie era o que o código antigo marcava como "não pode ir para
 * produção".
 */

const NAO_ENCONTRADO = () => new Response('não encontrado', { status: 404 })

/**
 * Sala reservada das rotas de licença.
 *
 * `/license/*` é do contêiner, não de uma integração — e o estado mora no Neon
 * compartilhado, então qualquer contêiner reflete a mesma licença. Um nome fixo
 * (e que passa em `salaValida`) mantém todas as chamadas de licença no mesmo.
 */
const SALA_DA_LICENCA = 'licencacompartilhada00'

export default {
    async fetch(pedido: Request, env: Ambiente, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(pedido.url)

        if (classificarRota(url.pathname) === 'webhook') {
            const partes = partesDaEntrada(url.pathname)
            if (!partes || !iguais(partes.segredo, env.POC_TOKEN) || !salaValida(partes.sala)) {
                return NAO_ENCONTRADO()
            }

            // Lido como texto cru, para repassar ao app byte a byte.
            const corpo = await pedido.text()
            let evento = 'desconhecido'
            try {
                evento = ((JSON.parse(corpo) as { event?: string }).event ?? 'desconhecido') as string
            } catch {
                // corpo não-JSON: segue como desconhecido, sem estourar.
            }
            console.log(`[entrada] ${partes.sala.slice(0, 8)} ${evento}`)

            // Reciclo: a autoridade para reiniciar é do objeto sobre o contêiner.
            if (eventoDisparaReciclo(evento)) {
                ctx.waitUntil(
                    getContainer(env.CANAL, partes.sala)
                        .fetch(new Request('http://canal/poc/pareou', { method: 'POST' }))
                        .then(() => undefined)
                        .catch((erro) => console.error('[entrada] reciclo falhou', erro))
                )
            }

            // Repasse ao app, verbatim. O evento carrega o token da instância
            // (o app é dono dela), então o app resolve a integração como sempre;
            // `?sala=` vai junto como rede de segurança.
            //
            // Pelo **service binding** `APP` quando existe: `fetch` público de um
            // Worker para o `workers.dev` de outro Worker da MESMA conta não
            // atravessa de forma confiável, e o evento se perdia calado (medido
            // 2026-10-22). O binding roteia pelo caminho da URL, não pelo host,
            // então a mesma `Request` serve aos dois. Sem binding, cai no público.
            if (env.APP_WEBHOOK_URL) {
                const destino = `${env.APP_WEBHOOK_URL}?sala=${encodeURIComponent(partes.sala)}`
                const req = new Request(destino, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: corpo,
                })
                const enviar = env.APP ? env.APP.fetch(req) : fetch(req)
                ctx.waitUntil(
                    enviar
                        .then(async (r) => {
                            // HTTP de erro não rejeita a promessa; registrar aqui
                            // é o que torna um 4xx/5xx do app visível no log.
                            if (!r.ok) console.error(`[entrada] app respondeu ${r.status}`)
                        })
                        .catch((erro) => console.error('[entrada] repasse ao app falhou', erro))
                )
            }

            // Webhook sempre 200: erro aqui vira repetição do Evolution Go.
            return Response.json({ ok: true })
        }

        // --- API, pelo service binding do app --------------------------------
        const gateway = pedido.headers.get(CABECALHO.GATEWAY) ?? ''
        if (!gateway || !env.EVOLUTION_GO_API_KEY || !iguais(gateway, env.EVOLUTION_GO_API_KEY)) {
            return NAO_ENCONTRADO()
        }

        const sala = url.pathname.startsWith('/license/')
            ? SALA_DA_LICENCA
            : (pedido.headers.get(CABECALHO.SALA) ?? '')
        if (!salaValida(sala)) {
            return new Response('sala ausente ou inválida', { status: 400 })
        }

        // Para o DO: o caminho e o corpo originais, mais a sala (ele a guarda
        // para montar o webhook e se reconectar). O `apikey` da instância segue
        // intacto no header.
        const interno = new Request('http://canal' + url.pathname + url.search, pedido)
        interno.headers.set(CABECALHO.SALA, sala)
        return getContainer(env.CANAL, sala).fetch(interno)
    },
}
