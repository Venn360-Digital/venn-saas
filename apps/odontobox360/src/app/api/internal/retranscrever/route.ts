import { NextRequest, NextResponse } from 'next/server'

import { APP } from '@venn/core/config/app'
import { enderecoDaMidia } from '@venn/core/lib/midia'
import { igualEmTempoConstante } from '@venn/core/lib/comparacao'
import prisma from '@venn/db/cliente'
import { transcribeAudio } from '@venn/core/trabalhos/servicos/transcribe'

/**
 * Retranscreve nota de voz que ficou sem texto.
 *
 * `POST /api/internal/retranscrever`, protegida pelo mesmo `IDENTITY_TOKEN` de
 * `/api/internal/identity` — é operação, não produto, e não aparece em tela
 * nenhuma.
 *
 * ## Por que existe
 *
 * Entre 03/11 e 05/11/2026 a chave da OpenAI de um dos produtos esteve
 * inválida. `transcribeAudio` reage devolvendo `null` e a mensagem é gravada de
 * todo jeito — que é o comportamento certo, porque perder a mensagem seria pior
 * que perder a transcrição —, mas o efeito é um acervo de áudios sem texto que
 * **nada reprocessa sozinho**: a transcrição acontece uma vez, no caminho de
 * entrada, e só quando `!isRetry`.
 *
 * Então o conserto da chave não conserta o passado. Esta rota conserta.
 *
 * ## Por que no Worker, e não num script
 *
 * Os bytes estão no R2 e o endereço é assinado por binding — um script na
 * máquina do dev não os alcança. E é o Worker que tem a chave.
 *
 * ## O que ela não faz
 *
 * Não apaga nem reescreve transcrição existente: `transcript: null` é o único
 * alvo, então rodar duas vezes não cobra duas vezes. E não mexe em mensagem
 * sem arquivo — sem bytes não há o que transcrever, e é por isso que a conta
 * de "sem arquivo" volta separada em vez de virar erro.
 *
 * ## Custo
 *
 * `gpt-4o-mini-transcribe` a ~US$ 0,003/min. Vinte notas de voz de um minuto
 * custam seis centavos de dólar. **Não debita crédito do cliente**: ele já
 * pagou por esta transcrição quando a mensagem chegou — foi a nossa
 * configuração que falhou, não o uso dele.
 */
const TETO_PADRAO = 50

export async function POST(req: NextRequest) {
    if (!APP().identityToken) {
        return NextResponse.json({ error: 'identidade não configurada' }, { status: 503 })
    }
    if (!igualEmTempoConstante(req.headers.get('x-identity-token') ?? '', APP().identityToken)) {
        return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const teto = Math.min(Number(searchParams.get('limite')) || TETO_PADRAO, 200)
    /** `?seco=1` mede sem gastar: diz quantas e quais, e não chama a OpenAI. */
    const seco = searchParams.get('seco') === '1'

    const pendentes = await prisma.message.findMany({
        where: {
            contentType: 'audio',
            direction: 'inbound',
            transcript: null,
            mediaUrl: { not: null },
        },
        orderBy: { createdAt: 'asc' },
        take: teto,
        select: { id: true, mediaUrl: true, createdAt: true, conversationId: true },
    })

    if (seco) {
        return NextResponse.json({
            seco: true,
            pendentes: pendentes.length,
            deQuando: {
                primeira: pendentes[0]?.createdAt ?? null,
                ultima: pendentes[pendentes.length - 1]?.createdAt ?? null,
            },
        })
    }

    let transcritas = 0
    let semArquivo = 0
    let semTexto = 0
    const falhas: { id: string; motivo: string }[] = []

    for (const msg of pendentes) {
        try {
            const endereco = await enderecoDaMidia(msg.mediaUrl)
            if (!endereco || !endereco.startsWith('http')) {
                semArquivo++
                continue
            }

            const arquivo = await fetch(endereco)
            if (!arquivo.ok) {
                falhas.push({ id: msg.id, motivo: `arquivo respondeu ${arquivo.status}` })
                continue
            }

            const bytes = new Uint8Array(await arquivo.arrayBuffer())
            if (!bytes.byteLength) {
                semArquivo++
                continue
            }

            /**
             * Base64 à mão porque `transcribeAudio` recebe base64 — é a forma
             * em que a mídia chega do provedor, e manter uma assinatura só
             * evita um segundo caminho de decodificação para divergir.
             */
            let bruto = ''
            for (let i = 0; i < bytes.byteLength; i += 0x8000) {
                bruto += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
            }
            const base64 = btoa(bruto)

            const texto = await transcribeAudio(
                base64,
                arquivo.headers.get('content-type') ?? undefined
            )

            if (!texto) {
                // `null` aqui já virou aviso dentro de `transcribeAudio`, com o
                // status e o formato. Contar é o que esta rota acrescenta.
                semTexto++
                continue
            }

            await prisma.message.update({ where: { id: msg.id }, data: { transcript: texto } })
            transcritas++
        } catch (erro) {
            falhas.push({ id: msg.id, motivo: String(erro).slice(0, 160) })
        }
    }

    return NextResponse.json({
        candidatas: pendentes.length,
        transcritas,
        semArquivo,
        semTexto,
        falhas,
    })
}
