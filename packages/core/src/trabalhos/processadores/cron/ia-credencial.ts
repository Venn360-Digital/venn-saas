import { APP } from '@/config/app.config'
import { OPENAI_BASE_URL } from '../../../lib/llm/base-url'
import { BRAND_HEX } from '../../../lib/palette'
import { sendEmail } from '../../../lib/email/send'
import { createLogger } from '../../registro'
import {
    assuntoDoAviso,
    comoConsertar,
    julgar,
    mereceAviso,
    type Veredito,
    type VereditoComAviso,
} from '../../../lib/llm/sonda'

const log = createLogger('CRON:IA-CREDENCIAL')

const DESTINO = process.env.ALERT_EMAIL ?? 'suporte@venn360.com'

/**
 * O modelo mais barato que exercita o caminho inteiro.
 *
 * Embedding e não `chat/completions`: uma palavra custa ~US$ 0,000000026 e a
 * resposta é determinística. E é o mesmo caminho — mesma base de URL, mesmo
 * gateway, mesma chave — que a transcrição e o agente percorrem. Se este passa,
 * o 401 que motivou esta rotina não está acontecendo.
 */
const MODELO_DA_SONDA = 'text-embedding-3-small'

/**
 * Uma vez por dia, prova que a IA deste app consegue falar com a OpenAI.
 *
 * **O defeito que esta rotina existe para impedir de se repetir.** Entre
 * 03/11/2026 e 05/11/2026 a chave da OpenAI da Odontobox esteve inválida. O
 * produto reagiu como foi escrito para reagir — `transcribeAudio` registra um
 * aviso e devolve `null`, e a mensagem é gravada de todo jeito —, então nada
 * quebrou de forma visível: 29 notas de voz entraram sem transcrição e
 * ninguém soube por três dias. O agente também teria falhado, mas naquela
 * conta todas as conversas são atribuídas a uma atendente, e conversa
 * atribuída silencia o agente: nem isso apareceu.
 *
 * Detectar sem avisar é o mesmo que não detectar — é a lição que o alerta de
 * linha caída já tinha ensinado, aplicada ao outro fornecedor.
 *
 * **Por que a sonda, e não um contador de falhas.** Contar falhas só funciona
 * se houver chamadas. Uma clínica em que o humano atende tudo não gera
 * chamada nenhuma, e foi esse o caso. A sonda gera a chamada ela mesma.
 *
 * **Não debita crédito de ninguém.** Não passa por `spendAiCredits`: é custo
 * nosso de operação, não uso do cliente. Por isso também não grava
 * `usage_logs` — aquela tabela mede margem sobre uso de cliente, e uma linha
 * diária de sonda sujaria a conta.
 *
 * **Sem estado, e sem aviso de retorno.** A rotina é diária, então a falha
 * rende um e-mail por dia enquanto durar, e a volta se anuncia pelo e-mail que
 * **não** chega. Guardar "estava quebrado ontem" exigiria uma linha de banco
 * para fechar um par queda/retorno que, aqui, ninguém precisa ver: o alerta de
 * linha caída avisa o retorno porque a linha se cura sozinha, e credencial não.
 */
export async function runIaCredencial(): Promise<void> {
    const veredito = await sondar()

    if (veredito.estado === 'ok') {
        log.info(`credencial de IA ok (${MODELO_DA_SONDA} via ${hostDaBase()})`)
        return
    }

    if (!mereceAviso(veredito)) {
        // 429 e 5xx são passageiros, e a sonda roda de novo amanhã. Fica no
        // log para quem for investigar, e não no e-mail de quem está dormindo.
        log.warn(`sonda de IA inconclusiva: ${descrever(veredito)}`)
        return
    }

    log.error(`credencial de IA com problema: ${descrever(veredito)}`)
    await avisar(veredito)
}

/** A chamada de rede, isolada: a decisão é de `lib/llm/sonda`. */
async function sondar(): Promise<Veredito> {
    const key = process.env.OPENAI_API_KEY
    if (!key) return { estado: 'sem-chave' }

    try {
        const resposta = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ model: MODELO_DA_SONDA, input: 'sonda' }),
        })

        const corpo = resposta.ok ? '' : (await resposta.text()).slice(0, 400)
        return julgar(resposta.status, corpo)
    } catch (erro) {
        /**
         * Rede caída não é credencial quebrada.
         *
         * Cair aqui com `estado: 'indisponivel'` e status 0 faz `mereceAviso`
         * devolver `false`, que é o que se quer: um `fetch` que nem completou
         * não prova nada sobre a chave, e avisar por isso seria o falso
         * positivo que esvazia o alerta.
         */
        return { estado: 'indisponivel', status: 0, detalhe: String(erro).slice(0, 200) }
    }
}

function descrever(v: Veredito): string {
    return v.estado === 'sem-chave'
        ? 'OPENAI_API_KEY ausente'
        : v.estado === 'ok'
          ? 'ok'
          : `${v.estado} (${v.status}) ${v.detalhe}`
}

function hostDaBase(): string {
    try {
        return new URL(OPENAI_BASE_URL).host
    } catch {
        return '(base inválida)'
    }
}

async function avisar(veredito: VereditoComAviso): Promise<void> {
    const campo = (rotulo: string, valor: string) =>
        `<tr><td style="color:${BRAND_HEX.slate};padding-right:12px">${rotulo}</td>` +
        `<td><strong>${valor}</strong></td></tr>`

    const passos = comoConsertar(veredito, APP.slug || 'app')
    const html =
        `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">` +
        `<p style="font-size:16px;font-weight:600;color:${BRAND_HEX.red};margin:0 0 12px">` +
        `A IA deste app não está conseguindo falar com a OpenAI</p>` +
        passos.map((p) => `<p style="margin:0 0 10px">${p}</p>`).join('') +
        `<table cellpadding="4" style="border-collapse:collapse;margin-top:8px">` +
        campo('Produto', `${APP.slug} / ${APP.env}`) +
        campo('Caminho', hostDaBase()) +
        campo('Modelo da sonda', MODELO_DA_SONDA) +
        campo(
            'Resposta',
            veredito.estado === 'sem-chave'
                ? 'nenhuma chave definida'
                : `${veredito.status} — ${escapar(veredito.detalhe)}`
        ) +
        campo('Quando', new Date().toISOString()) +
        `</table>` +
        `<p style="margin:14px 0 0;color:${BRAND_HEX.slate}">` +
        `Enquanto isto durar: nota de voz entra sem transcrição e o agente de IA ` +
        `não responde. Nenhuma mensagem é perdida.</p>` +
        `</div>`

    try {
        const r = await sendEmail({
            to: DESTINO,
            subject: assuntoDoAviso(veredito, `${APP.slug}/${APP.env}`),
            html,
        })
        if (!r.ok) log.error(`não consegui avisar a falha de credencial: ${r.error}`)
        else log.warn('suporte avisado da falha de credencial de IA')
    } catch (erro) {
        log.error('falha ao montar o aviso de credencial de IA', erro)
    }
}

/** O corpo do provedor vai para dentro de HTML; nunca cru. */
function escapar(texto: string): string {
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}
