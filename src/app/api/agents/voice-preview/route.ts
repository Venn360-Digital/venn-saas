import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'

/** As vozes que a tela oferece — a lista fechada evita gastar com palpite. */
const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const

const schema = z.object({
    voice: z.enum(VOICES),
    /** Frase de amostra; a tela manda a saudação do agente quando existe. */
    text: z.string().trim().max(200).optional(),
})

const FALLBACK = 'Olá! Sou o assistente da clínica. Como posso ajudar você hoje?'

/**
 * Modelos de fala, em ordem de tentativa.
 *
 * Projeto da OpenAI traz permissão por modelo, e um projeto criado só para
 * conversa e embedding responde **403 `model_not_found`** no `tts-1` — foi
 * exatamente o que aconteceu na primeira homologação. Tentar os dois cobre as
 * duas liberações possíveis; se nenhum passar, quem clicou precisa saber que o
 * problema é permissão, não a tela.
 */
const MODELS = ['gpt-4o-mini-tts', 'tts-1'] as const

/**
 * Ouvir a voz antes de escolher.
 *
 * O botão de play existia e não tocava nada — esperava dois segundos e voltava
 * ao normal, o que é pior que não ter botão: quem clica conclui que a voz está
 * muda, não que a tela está incompleta.
 *
 * O áudio é gerado e devolvido na hora, sem passar por fila nem por Storage:
 * são poucos segundos de fala que ninguém vai ouvir duas vezes, e guardar
 * amostra descartável custa mais que refazer. O texto é limitado a 200
 * caracteres porque isto é uma amostra, não um sintetizador aberto.
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return new NextResponse('Unauthorized', { status: 401 })

        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey) {
            return NextResponse.json(
                { error: 'A chave da OpenAI não está configurada neste ambiente.' },
                { status: 503 }
            )
        }

        const { voice, text } = schema.parse(await request.json())

        const input = text?.trim() || FALLBACK
        let lastStatus = 0
        let lastDetail = ''

        for (const model of MODELS) {
            const response = await fetch('https://api.openai.com/v1/audio/speech', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ model, voice, input, response_format: 'mp3' }),
            })

            if (response.ok) {
                return new NextResponse(await response.arrayBuffer(), {
                    headers: {
                        'Content-Type': 'audio/mpeg',
                        // Amostra é descartável: nenhum cache deve guardar.
                        'Cache-Control': 'no-store',
                    },
                })
            }

            lastStatus = response.status
            lastDetail = await response.text().catch(() => '')
            console.error('[VOICE_PREVIEW]', model, response.status, lastDetail.slice(0, 300))
        }

        /**
         * O motivo real chega à tela.
         *
         * "Não foi possível gerar a amostra" mandava quem testa abrir o log do
         * contêiner para descobrir que faltava liberar o modelo no painel da
         * OpenAI — uma frase genérica custou uma rodada inteira de homologação.
         */
        const blocked = lastStatus === 403 || /model_not_found/.test(lastDetail)
        return NextResponse.json(
            {
                error: blocked
                    ? 'O projeto da OpenAI desta instalação não tem permissão para os modelos de voz (tts-1 / gpt-4o-mini-tts). Libere o modelo no painel da OpenAI, em Project → Limits.'
                    : 'Não foi possível gerar a amostra agora.',
            },
            { status: 502 }
        )
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: 'Voz inválida.' }, { status: 400 })
        }
        console.error('[VOICE_PREVIEW]', error)
        return NextResponse.json({ error: 'Erro ao gerar a amostra.' }, { status: 500 })
    }
}
