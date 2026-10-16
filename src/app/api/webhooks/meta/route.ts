import { NextRequest, NextResponse } from 'next/server'

import {
    metaAppSecret,
    metaSignatureValid,
    metaVerifyToken,
    normalizarEventoMeta,
} from '@/lib/meta/webhook'

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

    const appSecret = await metaAppSecret()
    if (!appSecret) {
        console.error('[META_WEBHOOK] evento recusado: app da Meta sem credencial registrada')
        return new NextResponse('app not configured', { status: 503 })
    }

    const assinatura = request.headers.get('x-hub-signature-256')
    if (!metaSignatureValid(rawBody, assinatura, appSecret)) {
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

    /**
     * Ainda não há para onde rotear, e isto é verdade e não lacuna.
     *
     * O que liga o id da conta da Meta a um workspace nasce quando a clínica
     * conecta, pelo Embedded Signup — que ainda não existe. Até lá o único
     * emissor possível é o número de teste da própria Venn360, e o valor deste
     * caminho é provar que a corrente chega inteira: assinatura conferida,
     * corpo entendido, resposta dentro do tempo.
     *
     * O log abaixo é essa prova. Quando a tabela de ligação existir, ela entra
     * aqui, e o enfileiramento com ela.
     */
    console.log(
        `[META_WEBHOOK] ${evento.canal} · conta=${evento.contaId ?? '—'} ` +
            `numero=${evento.numeroId ?? '—'} campo=${evento.campo ?? '—'}`
    )

    return NextResponse.json({ received: true })
}
