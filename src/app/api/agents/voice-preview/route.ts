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

        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'tts-1',
                voice,
                input: text?.trim() || FALLBACK,
                response_format: 'mp3',
            }),
        })

        if (!response.ok) {
            const detail = await response.text().catch(() => '')
            console.error('[VOICE_PREVIEW]', response.status, detail.slice(0, 300))
            return NextResponse.json(
                { error: 'Não foi possível gerar a amostra agora.' },
                { status: 502 }
            )
        }

        return new NextResponse(await response.arrayBuffer(), {
            headers: {
                'Content-Type': 'audio/mpeg',
                // Amostra é descartável: nenhum cache intermediário deve guardar.
                'Cache-Control': 'no-store',
            },
        })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: 'Voz inválida.' }, { status: 400 })
        }
        console.error('[VOICE_PREVIEW]', error)
        return NextResponse.json({ error: 'Erro ao gerar a amostra.' }, { status: 500 })
    }
}
