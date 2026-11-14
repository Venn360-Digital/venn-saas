import { NextRequest, NextResponse } from 'next/server'

import { readInstagramEvent } from '@venn/core/lib/instagram/webhook'
import { readWhatsAppCloudEvent } from '@venn/core/lib/whatsapp/envelopes'
import {
    ehEventoDeInstagram,
    metaAppSecrets,
    metaSignatureValid,
    metaVerifyToken,
    normalizarEventoMeta,
} from '@venn/core/lib/meta/webhook'
import { enqueueNormalizedEvents, MissingRedisUrlError } from '@venn/core/lib/queue/enqueue-whatsapp'

export const runtime = 'nodejs'
/** Nada aqui pode ser servido de cache: cada evento é um evento. */
export const dynamic = 'force-dynamic'

/**
 * O webhook da Meta — WhatsApp Cloud API e Instagram Direct, na mesma porta.
 *
 * A Meta dá **uma URL por produto, não por cliente**: os eventos de todas as
 * clínicas chegam aqui e somos nós que roteamos pelo id da conta. É o oposto do
 * Evolution Go, onde cada instância tem a sua.
 *
 * Duas requisições diferentes caem nesta rota, e elas não se parecem:
 *
 * - **GET** é o aperto de mão, uma vez, quando alguém salva a URL no painel da
 *   Meta. Ela manda um desafio e espera o desafio de volta.
 * - **POST** é o evento, para sempre, assinado.
 */

/**
 * O aperto de mão.
 *
 * A Meta manda `hub.mode=subscribe`, o `hub.verify_token` que foi configurado no
 * painel, e um `hub.challenge` aleatório. Conferimos o token e devolvemos o
 * desafio **cru**, com 200 — JSON aqui faz a Meta recusar, porque ela compara o
 * corpo inteiro com o que mandou.
 */
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams
    const mode = params.get('hub.mode')
    const token = params.get('hub.verify_token')
    const challenge = params.get('hub.challenge')

    // Sem os três, não é aperto de mão: é alguém abrindo a URL no navegador.
    if (!mode || !token || !challenge) {
        return NextResponse.json({ ok: true, service: 'meta-webhook' })
    }

    const esperado = await metaVerifyToken()

    if (!esperado) {
        console.error('[META_WEBHOOK] aperto de mão recusado: nenhum token de verificação registrado')
        return new NextResponse('verify token not configured', { status: 403 })
    }

    if (mode !== 'subscribe' || token !== esperado) {
        console.warn('[META_WEBHOOK] aperto de mão recusado: token não confere')
        return new NextResponse('forbidden', { status: 403 })
    }

    console.log('[META_WEBHOOK] aperto de mão aceito')
    return new NextResponse(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
    })
}

/**
 * O evento.
 *
 * Três regras que a Meta impõe e que mandam na forma deste código:
 *
 * 1. **Assinar sobre os bytes crus.** Por isso `request.text()` e não
 *    `request.json()` — reserializar reordena chaves e a assinatura nunca bate.
 * 2. **Responder 200 em menos de 20 segundos.** Qualquer trabalho de verdade vai
 *    para fila; aqui só se confere e se reconhece.
 * 3. **Deduplicar.** A Meta reenvia o que não foi reconhecido por até sete dias,
 *    e o aviso de que devemos deduplicar está na documentação dela.
 *
 * E uma nossa: **evento inválido também responde 200**, exceto quando a
 * assinatura falha. Corpo que não entendemos não melhora sendo reenviado por
 * sete dias; assinatura inválida, sim, tem que ser recusada alto.
 */
export async function POST(request: NextRequest) {
    const rawBody = await request.text()

    /**
     * Duas chaves, porque são dois aplicativos.
     *
     * O WhatsApp oficial assina com a chave do app do Facebook; o Instagram
     * Direct, com a do produto Instagram, que é outra. Conferir só uma
     * rejeitaria metade do tráfego como "assinatura inválida" — mensagem que
     * faz procurar ataque onde há configuração.
     */
    const segredos = await metaAppSecrets()
    if (segredos.length === 0) {
        console.error('[META_WEBHOOK] evento recusado: nenhum app da Meta com credencial registrada')
        return new NextResponse('app not configured', { status: 503 })
    }

    const assinatura = request.headers.get('x-hub-signature-256')
    if (!segredos.some((segredo) => metaSignatureValid(rawBody, assinatura, segredo))) {
        console.warn('[META_WEBHOOK] evento recusado: assinatura inválida')
        return new NextResponse('invalid signature', { status: 401 })
    }

    let corpo: unknown
    try {
        corpo = JSON.parse(rawBody)
    } catch {
        console.warn('[META_WEBHOOK] corpo não é JSON; reconhecido para não ser reenviado')
        return NextResponse.json({ received: true, ignored: 'corpo inválido' })
    }

    const evento = normalizarEventoMeta(corpo)

    console.log(
        `[META_WEBHOOK] ${evento.canal} · conta=${evento.contaId ?? '—'} ` +
            `numero=${evento.numeroId ?? '—'} campo=${evento.campo ?? '—'}`
    )

    /**
     * O Instagram entra na mesma fila do WhatsApp, de propósito.
     *
     * Daqui para frente não há diferença entre os canais: contato, conversa,
     * mídia, agente, crédito e caixa de entrada são os mesmos. Normalizar na
     * borda — como já é feito com os dois envelopes do Evolution — é o que
     * mantém o worker sem um `if` por canal.
     *
     * O nome da fila continua "whatsapp-inbound" porque é o nome dela no Redis:
     * renomeá-la para ficar bonita descartaria o que estivesse em voo.
     */
    if (ehEventoDeInstagram(corpo)) {
        try {
            const eventos = readInstagramEvent(corpo)
            const resultado = await enqueueNormalizedEvents('meta-instagram', eventos)
            return NextResponse.json({ received: true, ...resultado })
        } catch (error) {
            if (error instanceof MissingRedisUrlError) {
                console.error('[META_WEBHOOK] REDIS_URL não está configurada')
                return NextResponse.json({ error: 'Queue unavailable' }, { status: 503 })
            }

            /**
             * Falhar alto aqui é o certo: a Meta reenvia.
             *
             * Ao contrário do corpo inválido, que não melhora sendo reenviado,
             * uma fila fora do ar é transitória — e responder 200 faria a
             * mensagem do paciente ser descartada em silêncio.
             */
            console.error('[META_WEBHOOK] falha ao enfileirar evento do Instagram', error)
            return NextResponse.json({ error: 'Enqueue failed' }, { status: 500 })
        }
    }

    /**
     * WhatsApp oficial, direto da Meta — sem Evolution no meio.
     *
     * Desde 2026-10-22 o canal oficial fala direto com a Graph API, e o inbound
     * entra por aqui em vez de ser traduzido pelo Evolution v2. `account_update`
     * e o `ping` de teste do painel viram lista vazia e param no 200 abaixo —
     * não há o que enfileirar neles.
     *
     * Falhar alto numa fila fora do ar é o certo, igual ao Instagram: a Meta
     * reenvia por sete dias, e responder 200 descartaria a mensagem do paciente.
     */
    try {
        const eventos = readWhatsAppCloudEvent(corpo)
        if (eventos.length === 0) return NextResponse.json({ received: true })

        const resultado = await enqueueNormalizedEvents('meta-whatsapp', eventos)
        return NextResponse.json({ received: true, ...resultado })
    } catch (error) {
        if (error instanceof MissingRedisUrlError) {
            console.error('[META_WEBHOOK] REDIS_URL não está configurada')
            return NextResponse.json({ error: 'Queue unavailable' }, { status: 503 })
        }

        console.error('[META_WEBHOOK] falha ao enfileirar evento do WhatsApp', error)
        return NextResponse.json({ error: 'Enqueue failed' }, { status: 500 })
    }
}
