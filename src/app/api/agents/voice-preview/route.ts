import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireWritable } from '@/lib/billing'
import { MANAGER_ROLES, getWorkspaceMember } from '@/lib/auth/workspace'
import { TTS_MODELS } from '@/lib/llm/models'
import { VOZES_IDS } from '@/lib/voz'


const schema = z.object({
    /* A lista fechada evita gastar com palpite, e vem de `lib/voz.ts`:
       tela e rota precisam oferecer exatamente as mesmas. */
    voice: z.enum(VOZES_IDS),
    /**
     * Entonação — o campo `instructions` do modelo de fala.
     *
     * Era `text`, a frase a ser lida, e a tela mandava nele o que a clínica
     * escrevia no campo de entonação: quem pedia "fale devagar" ouvia a voz
     * dizendo "fale devagar". A amostra agora fala sempre a mesma frase, com a
     * entonação pedida — que é o que o paciente vai ouvir.
     */
    instructions: z.string().trim().max(2000).optional(),
})

const FALLBACK = 'Olá! Sou o assistente da clínica. Como posso ajudar você hoje?'

/**
 * Os modelos vêm do catálogo, em ordem de tentativa.
 *
 * Projeto da OpenAI traz permissão por modelo, e um projeto criado só para
 * conversa e embedding responde **403 `model_not_found`** no `tts-1` — foi
 * exatamente o que aconteceu na primeira homologação. Tentar os dois cobre as
 * duas liberações possíveis; se nenhum passar, quem clicou precisa saber que o
 * problema é permissão, não a tela.
 *
 * A lista era uma cópia local. Agora é a mesma que o worker usa para falar com
 * o paciente, e o mesmo campo `acceptsInstructions` decide quem recebe a
 * entonação — amostra e resposta de verdade não podem divergir, senão a clínica
 * escolhe ouvindo uma coisa e entrega outra.
 */

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
 *
 * A autorização era só "ter sessão". Com o cadastro aberto para homologação,
 * isso fazia da rota um sintetizador de fala gratuito na nossa chave da OpenAI,
 * para qualquer pessoa que criasse uma conta. Agora pede o que a tela que a
 * chama já exige: ser gestão de um workspace que pode escrever. Escolher a voz
 * do agente é configuração, não trabalho de atendimento.
 */
export async function POST(request: NextRequest) {
    try {
        const auth = await getWorkspaceMember()
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status })
        }

        if (!MANAGER_ROLES.includes(auth.member.role)) {
            return NextResponse.json(
                { error: 'Você não tem permissão para configurar o agente' },
                { status: 403 }
            )
        }

        // Avaliação encerrada ou plano sem pagamento não gera áudio: é custo
        // nosso numa conta que não está pagando.
        const writable = await requireWritable(auth.member.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey) {
            return NextResponse.json(
                { error: 'A chave da OpenAI não está configurada neste ambiente.' },
                { status: 503 }
            )
        }

        const { voice, instructions } = schema.parse(await request.json())

        const input = FALLBACK
        let lastStatus = 0
        let lastDetail = ''

        for (const model of TTS_MODELS) {
            const body: Record<string, unknown> = {
                model: model.id,
                voice,
                input,
                // mp3 aqui, e não o opus que vai ao WhatsApp: isto toca num
                // `<audio>` do navegador, onde mp3 é o que todo navegador lê.
                response_format: 'mp3',
            }

            // Mandar `instructions` para quem não aceita é 400 num modelo que
            // funcionaria sem ele.
            /*
             * A amostra ouve exatamente o que está no campo — nada somado por
             * baixo. Amostra e resposta de verdade não podem divergir, senão a
             * clínica escolhe ouvindo uma coisa e entrega outra ao paciente.
             */
            if (instructions && model.acceptsInstructions) body.instructions = instructions

            const response = await fetch('https://api.openai.com/v1/audio/speech', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
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
            console.error('[VOICE_PREVIEW]', model.id, response.status, lastDetail.slice(0, 300))
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
