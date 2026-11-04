import { asaas } from '@/lib/asaas/client'

/**
 * O estado da fila de webhooks do Asaas — o defeito que não dá sintoma.
 *
 * A documentação deles é explícita: **depois de 15 falhas consecutivas a fila
 * para**. Os eventos continuam a ser gerados e deixam de ser enviados até
 * alguém reativar no painel. Do nosso lado isso não parece nada: nenhum erro,
 * nenhum log, só cobranças que confirmam no Asaas e planos que não entram
 * aqui. Foi por essa razão que a rota do webhook grava antes de pensar — e é
 * por essa mesma razão que alguém precisa olhar a fila de fora.
 *
 * `GET /v3/webhooks` devolve o que interessa, medido contra o sandbox em
 * 2026-10-20: `enabled`, `interrupted`, `penalizedRequestsCount`,
 * `hasAuthToken`, `sendType` e `apiVersion`.
 *
 * `hasAuthToken` e não `authToken`: o campo com o valor não existe na
 * resposta, e ler o nome errado já me fez anunciar um falso alarme de "webhook
 * sem token" neste mesmo projeto.
 */

export interface WebhookDoAsaas {
    id: string
    name?: string
    url?: string
    enabled?: boolean
    /** A fila parou. É o estado que ninguém percebe sem olhar. */
    interrupted?: boolean
    /** Quantas entregas foram penalizadas; cresce antes de a fila parar. */
    penalizedRequestsCount?: number
    hasAuthToken?: boolean
    sendType?: string
    apiVersion?: number
}

export interface EstadoDoWebhook {
    /** Nenhum problema encontrado. */
    ok: boolean
    /** O que há de errado, em português, para log e para tela. */
    problemas: string[]
    webhooks: WebhookDoAsaas[]
}

/**
 * O caminho público que o Asaas tem de chamar **neste** app.
 *
 * `WEBHOOK_BASE_URL` e não a URL pública do app pela mesma razão que o WhatsApp
 * usa: a base certa para quem nos chama de fora pode não ser a mesma que o
 * navegador usa. Sem nenhuma das duas, devolve vazio e a conferência de
 * pertencimento é pulada — ela não pode ser o que derruba a tela.
 */
function nossoCaminho(): string {
    const base = (process.env.WEBHOOK_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(
        /\/+$/,
        ''
    )
    return base ? `${base}/api/webhooks/asaas` : ''
}

export async function estadoDoWebhook(): Promise<EstadoDoWebhook> {
    const lista = await asaas<{ data?: WebhookDoAsaas[] }>('/webhooks?limit=20')
    const webhooks = lista.data ?? []

    const problemas: string[] = []

    if (webhooks.length === 0) {
        problemas.push('Nenhum webhook registrado: nada do Asaas chega até aqui.')
    }

    /**
     * **A lista é da conta Asaas, não deste app** — e isso era um falso verde.
     *
     * Uma conta Asaas pode servir mais de um produto da Venn360. `GET
     * /webhooks` devolve os webhooks da **conta**, então o webhook saudável de
     * outro produto bastava para esta tela dizer "fila saudável" enquanto a URL
     * deste app não estava registrada em lugar nenhum. O veredito era sobre o
     * vizinho.
     *
     * Então a conferência passou a ser de pertencimento: entre os registrados,
     * algum é o **nosso** caminho? A comparação é pelo caminho público completo,
     * que é único por produto (`<produto>.venn360.com/api/webhooks/asaas`).
     *
     * E os problemas abaixo passam a ser reportados **apenas dos nossos**: fila
     * interrompida do outro produto é problema real, mas não é deste painel, e
     * mostrá-lo aqui mandaria alguém procurar no lugar errado.
     */
    const caminho = nossoCaminho()
    const nossos = caminho
        ? webhooks.filter((w) => (w.url ?? '').replace(/\/+$/, '') === caminho)
        : webhooks

    if (caminho && webhooks.length > 0 && nossos.length === 0) {
        problemas.push(
            `Nenhum webhook aponta para ${caminho}. Há ${webhooks.length} registrado(s) nesta ` +
                'conta do Asaas, mas nenhum é deste sistema — os eventos não chegam aqui.'
        )
    }

    for (const w of nossos) {
        const nome = w.name || w.url || w.id

        if (w.interrupted) {
            problemas.push(
                `A fila de "${nome}" está interrompida — os eventos param de ser enviados ` +
                    'até alguém reativar no painel do Asaas.'
            )
        }

        if (w.enabled === false) {
            problemas.push(`O webhook "${nome}" está desligado.`)
        }

        if ((w.penalizedRequestsCount ?? 0) > 0) {
            problemas.push(
                `"${nome}" acumulou ${w.penalizedRequestsCount} entrega(s) penalizada(s). ` +
                    'São 15 falhas seguidas para a fila parar.'
            )
        }

        if (w.hasAuthToken === false) {
            problemas.push(
                `"${nome}" está sem token de autenticação: qualquer um poderia postar ` +
                    'eventos forjados na nossa rota.'
            )
        }
    }

    return { ok: problemas.length === 0, problemas, webhooks }
}
