import { APP } from '../../config/app'
import { BRAND_HEX } from '../palette'
import { sendEmail } from '../email/send'

/**
 * O e-mail de incidente do Asaas, montado num lugar só.
 *
 * ## Por que não em cada chamador
 *
 * Porque são **dois** que avisam a mesma coisa: a sonda diária
 * (`cron/asaas-credencial.ts`) e o webhook de chave de API
 * (`chave-de-api.ts`). Os dois podem relatar o mesmo incidente — uma chave
 * desabilitada por inatividade chega pelo evento `ACCESS_TOKEN_DISABLED` e, no
 * dia seguinte, pela sonda — e duas cópias do mesmo e-mail divergem na primeira
 * correção. É a lição que `lib/comparacao.ts` abre registrando: três cópias do
 * mesmo cuidado é como a terceira acaba sem ele.
 *
 * ## O que ele garante
 *
 * **Nunca o valor da chave.** Quem chama passa status, código e descrição do
 * Asaas; o segredo não entra em parâmetro nenhum, e por isso não há caminho
 * para ele acabar num corpo de e-mail.
 *
 * E **escapa tudo**: o texto do provedor vai para dentro de HTML, e corpo de
 * erro não é conteúdo confiável só porque veio de uma API conhecida.
 */

export interface AlertaDoAsaas {
    /** A linha que quem lê às 3 h da manhã lê sozinha. */
    assunto: string
    /** Uma frase por parágrafo: o que houve, o efeito, e o comando que conserta. */
    passos: string[]
    /** Rótulo → valor, na tabela do fim. Nunca segredo. */
    campos: Record<string, string>
}

const DESTINO = process.env.ALERT_EMAIL ?? 'suporte@venn360.com'

/**
 * O nome do Worker, que é o que falta no comando do `wrangler secret put`.
 *
 * Em homologação ele leva o sufixo `-stg`, e um e-mail que mandasse
 * `--name odontobox` para um incidente de staging faria o operador gravar o
 * segredo **em produção**. É o pior desfecho possível de um alerta, então o
 * nome é derivado e não escrito à mão em cada texto.
 */
export function nomeDoWorker(): string {
    const slug = APP().slug || 'app'
    return APP().env === 'production' ? slug : `${slug}-stg`
}

/** O que o produto perde enquanto a credencial não responde. */
export const CONSEQUENCIA_SEM_CREDENCIAL =
    'Enquanto isto durar, ninguém consegue contratar plano nem comprar adicional: a ' +
    'cobrança não é criada. Quem já é cliente continua atendendo — o corte por ' +
    'inadimplência não depende desta chave.'

export async function avisarSuporte(alerta: AlertaDoAsaas): Promise<void> {
    const campo = (rotulo: string, valor: string) =>
        `<tr><td style="color:${BRAND_HEX.slate};padding-right:12px;vertical-align:top">${escapar(rotulo)}</td>` +
        `<td><strong>${escapar(valor)}</strong></td></tr>`

    const html =
        `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">` +
        `<p style="font-size:16px;font-weight:600;color:${BRAND_HEX.red};margin:0 0 12px">` +
        `${escapar(alerta.assunto)}</p>` +
        // Os passos trazem `<code>` e `<strong>` de propósito e são escritos por
        // nós, nunca pelo provedor — então vão como estão. O que vem do Asaas
        // entra pelos `campos`, que escapam.
        alerta.passos.map((p) => `<p style="margin:0 0 10px">${p}</p>`).join('') +
        `<table cellpadding="4" style="border-collapse:collapse;margin-top:8px">` +
        campo('Produto', `${APP().slug} / ${APP().env}`) +
        Object.entries(alerta.campos)
            .map(([rotulo, valor]) => campo(rotulo, valor))
            .join('') +
        campo('Quando', new Date().toISOString()) +
        `</table>` +
        `</div>`

    const r = await sendEmail({
        to: DESTINO,
        subject: `[${APP().slug}/${APP().env}] ${alerta.assunto}`,
        html,
    })

    if (!r.ok) throw new Error(`e-mail de alerta não saiu: ${r.error}`)
}

/** O texto do provedor vai para dentro de HTML; nunca cru. */
export function escapar(texto: string): string {
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}
