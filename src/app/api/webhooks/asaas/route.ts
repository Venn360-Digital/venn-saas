import { igualEmTempoConstante } from '@/lib/comparacao'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { asaasWebhookToken } from '@/lib/asaas/client'
import { QUEUE } from '@/lib/queue/definitions'
import { entregar } from '@/lib/queue/entregar'
import { isUniqueViolation } from '@venn/db/erros'

/**
 * O endpoint que o Asaas chama. Grava, responde 200, e processa na fila.
 *
 * Esta rota não decide nada sobre cobrança. Ela recebe, confere quem está
 * falando, guarda o corpo e sai. Toda a interpretação — ativar plano, creditar
 * compra, cortar inadimplente — acontece no worker, lendo a linha gravada.
 *
 * TRÊS FRASES DA DOCUMENTAÇÃO DO ASAAS DESENHARAM ISTO
 *
 * **"Responda imediatamente com HTTP 200 OK, então execute processamentos
 * assíncronos."** Processar dentro da requisição faria a nossa latência virar o
 * tempo de resposta que eles medem.
 *
 * **"Após 15 falhas consecutivas a fila pode ser interrompida"** — e os eventos
 * continuam a ser gerados sem serem enviados, até alguém reativar. Ou seja: um
 * `500` nosso repetido não atrasa um evento, **para a torneira**. Cliente paga,
 * nada acontece, e o sistema não tem como saber que não soube. É por isso que o
 * único jeito desta rota falhar é o banco estar fora.
 *
 * **"O modelo é at least once"** — o mesmo evento chega mais de uma vez.
 * `asaasEventId` é único no banco: a segunda chegada colide, e a colisão é
 * resposta de sucesso, não erro. Sem isso, um reenvio de `PAYMENT_CONFIRMED`
 * criaria o segundo lote de 10.000 créditos de graça.
 *
 * AUTENTICAÇÃO
 *
 * O header `asaas-access-token` leva um token **que nós inventamos** e colamos
 * no painel deles ao cadastrar a URL. Não é a chave de API — a própria
 * documentação avisa para não usar a chave aqui, e o motivo é bom: este valor
 * viaja em toda chamada para um endpoint público.
 */

/** Sem token guardado, a rota recusa tudo — inclusive o Asaas de verdade. */
async function autenticado(request: NextRequest): Promise<boolean> {
    const esperado = await asaasWebhookToken()
    if (!esperado) {
        console.error('[ASAAS_WEBHOOK] nenhum token registrado na plataforma; recusando')
        return false
    }
    /**
     * Tempo constante, como Meta e Evolution. Era `===` — a única das três
     * portas sem o cuidado, e por isso a que mais precisava dele: o token aqui
     * é um valor que nós inventamos e colamos no painel do Asaas, logo é
     * adivinhável byte a byte se o tempo de resposta contar a história.
     */
    return igualEmTempoConstante(request.headers.get('asaas-access-token') ?? '', esperado)
}

interface CorpoDoAsaas {
    id?: string
    event?: string
    dateCreated?: string
}

export async function POST(request: NextRequest) {
    if (!(await autenticado(request))) {
        // 401 e não 403: o Asaas trata os dois como falha, e 401 é o que diz
        // "não reconheci quem está falando" para quem for ler o log.
        return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
    }

    let corpo: CorpoDoAsaas & Record<string, unknown>
    try {
        corpo = await request.json()
    } catch {
        // Corpo ilegível não vai melhorar na retentativa. 400 e segue a vida —
        // é o único caso em que recusar não arrisca parar a fila deles, porque
        // não é falha nossa.
        return NextResponse.json({ error: 'corpo inválido' }, { status: 400 })
    }

    const asaasEventId = typeof corpo.id === 'string' ? corpo.id : null
    const event = typeof corpo.event === 'string' ? corpo.event : null

    if (!asaasEventId || !event) {
        return NextResponse.json({ error: 'evento sem id ou sem tipo' }, { status: 400 })
    }

    try {
        const linha = await prisma.asaasEvent.create({
            data: { asaasEventId, event, payload: corpo as object },
            select: { id: true },
        })

        /**
         * Enfileirar **depois** de gravar, e falhar calado se o Redis estiver
         * fora.
         *
         * A linha gravada é o que importa: com ela, um reprocessamento manual ou
         * o job de conciliação alcançam o evento depois. Devolver erro aqui por
         * causa do Redis trocaria uma pendência nossa por uma fila parada do
         * lado deles — que é o problema maior.
         */
        try {
            await entregar(QUEUE.ASAAS_EVENT, { eventRowId: linha.id }, { nome: 'asaas-event' })
        } catch (erro) {
            console.error('[ASAAS_WEBHOOK] evento gravado mas não enfileirado', linha.id, erro)
        }

        return NextResponse.json({ received: true })
    } catch (erro) {
        if (isUniqueViolation(erro)) {
            // Reenvio do mesmo evento. É sucesso: já temos, e processar de novo
            // não é o que o Asaas está pedindo — ele só quer o 200.
            return NextResponse.json({ received: true, duplicate: true })
        }
        console.error('[ASAAS_WEBHOOK] falha ao gravar evento', erro)
        return NextResponse.json({ error: 'erro ao gravar' }, { status: 500 })
    }
}
