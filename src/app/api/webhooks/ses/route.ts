import { NextRequest, NextResponse } from 'next/server'

import { QUEUE } from '@/lib/queue/definitions'
import { entregar } from '@/lib/queue/entregar'
import { assinaturaDoSnsValida, lerMensagemDoSns } from '@/lib/email/sns'

export const runtime = 'nodejs'
/** Nada aqui pode ser servido de cache: cada recibo é um recibo. */
export const dynamic = 'force-dynamic'

/**
 * O webhook de recibos do SES, pelo Amazon SNS.
 *
 * ## O caminho inteiro
 *
 * O configuration set do app publica os eventos (entrega, abertura, clique,
 * bounce, reclamação) num tópico do SNS, e o tópico os entrega aqui por HTTPS.
 * Esta rota **não processa** — ela confere a assinatura e enfileira, porque o
 * SNS desiste em 15 segundos e reentrega o que não recebeu 200 a tempo.
 *
 * ## Três requisições diferentes caem aqui
 *
 * - **`SubscriptionConfirmation`**, uma vez, quando o tópico é apontado para
 *   esta URL. Ela traz um `SubscribeURL` que **precisa ser visitado** — sem
 *   isso a assinatura fica `PendingConfirmation` para sempre e nenhum recibo
 *   chega. É o passo que se esquece e que não dá erro nenhum.
 * - **`Notification`**, para sempre: o recibo.
 * - **`UnsubscribeConfirmation`**, se alguém desfizer a assinatura.
 *
 * ## Por que a assinatura é conferida, e não só o `TopicArn`
 *
 * A rota é pública por construção — quem chama é a AWS, não um usuário logado.
 * Conferir só o ARN do tópico seria conferir um dado que o próprio atacante
 * escreve no corpo. Sem a assinatura, um POST forjado marca contatos como
 * opt-out e pede ao SES para suprimir endereços da conta inteira: descadastra
 * pacientes de qualquer clínica, em silêncio, e a clínica só percebe quando a
 * campanha seguinte sair pela metade.
 *
 * Ver `src/lib/email/sns.ts` — inclusive por que o host do certificado é
 * validado antes de buscá-lo.
 */
export async function POST(request: NextRequest) {
    /**
     * O corpo cru, e só depois o objeto.
     *
     * A string canônica que o SNS assinou é montada a partir dos campos, não do
     * JSON inteiro — então aqui reserializar não quebra nada, diferente do
     * webhook da Meta. Mas ler cru mantém o mesmo formato das outras portas e
     * evita que um corpo inválido estoure antes da checagem.
     */
    const cru = await request.text()
    const mensagem = lerMensagemDoSns(cru)

    /**
     * 400 para corpo que não é mensagem do SNS.
     *
     * Não 200: o SNS trata 2xx como "entregue" e descarta. Devolver 200 a algo
     * que não entendemos esconderia uma mudança de formato da AWS atrás de um
     * silêncio.
     */
    if (!mensagem) {
        return new NextResponse('corpo não é uma mensagem do SNS', { status: 400 })
    }

    if (!(await assinaturaDoSnsValida(mensagem))) {
        // 403 e nada mais. Dizer *por que* falhou (certificado, assinatura,
        // tipo) entrega a quem está sondando o mapa do que falta acertar.
        return new NextResponse('assinatura inválida', { status: 403 })
    }

    if (mensagem.Type === 'SubscriptionConfirmation') {
        return confirmarAssinatura(mensagem.SubscribeURL)
    }

    if (mensagem.Type === 'UnsubscribeConfirmation') {
        // Nada a fazer, mas registra: é um estado em que recibo nenhum chega, e
        // a causa precisa estar no log de quem for investigar o silêncio.
        console.warn('[SES] assinatura do tópico foi desfeita; recibos pararão de chegar')
        return NextResponse.json({ ok: true })
    }

    await entregar(
        QUEUE.SES_EVENT,
        { snsMessageId: mensagem.MessageId, corpo: mensagem.Message },
        { nome: 'ses-event' }
    )

    return NextResponse.json({ ok: true })
}

/**
 * Visita o `SubscribeURL` para o tópico sair de `PendingConfirmation`.
 *
 * A URL vem **de dentro do corpo**, então ela é tão confiável quanto o corpo —
 * e o corpo já teve a assinatura conferida acima. Ainda assim o host é
 * validado: a assinatura prova que a AWS escreveu a mensagem, não que o
 * endereço aponta para a AWS, e buscar uma URL arbitrária a partir do servidor
 * é um SSRF com passos extras.
 */
async function confirmarAssinatura(url: string | undefined): Promise<NextResponse> {
    if (!url || !hostDoSnsConfiavel(url)) {
        return new NextResponse('SubscribeURL inválida', { status: 400 })
    }

    try {
        const r = await fetch(url)
        if (!r.ok) {
            console.error(`[SES] confirmação da assinatura falhou: HTTP ${r.status}`)
            // 500 faz o SNS reentregar, e reentregar aqui é exatamente o que se
            // quer: a confirmação é a única chance de ligar o tópico.
            return new NextResponse('não foi possível confirmar', { status: 500 })
        }
        console.info('[SES] assinatura do tópico confirmada; recibos vão começar a chegar')
        return NextResponse.json({ ok: true })
    } catch {
        return new NextResponse('não foi possível confirmar', { status: 500 })
    }
}

/** Mesma regra do certificado: só host do SNS, só HTTPS. */
function hostDoSnsConfiavel(url: string): boolean {
    try {
        const alvo = new URL(url)
        return (
            alvo.protocol === 'https:' &&
            /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(alvo.hostname)
        )
    } catch {
        return false
    }
}
