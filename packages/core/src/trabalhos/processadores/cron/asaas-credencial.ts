import { asaasConfig } from '../../../lib/asaas/client'
import { avisarSuporte, nomeDoWorker } from '../../../lib/asaas/alerta'
import { createLogger } from '../../registro'
import {
    assuntoDoAviso,
    comoConsertar,
    julgar,
    mereceAviso,
    type Veredito,
    type VereditoComAviso,
} from '../../../lib/asaas/sonda'

const log = createLogger('CRON:ASAAS-CREDENCIAL')

/**
 * A chamada mais leve que exercita o caminho inteiro de autenticação.
 *
 * `GET /v3/myAccount/commercialInfo` — leitura pura, sem parâmetro, sem
 * paginação, sem efeito colateral. Não cria cliente, não mexe em cobrança, e
 * percorre exatamente o que uma contratação percorre: mesma base de URL derivada
 * do prefixo da chave, mesmo header `access_token`.
 *
 * Não é `GET /v3/customers?limit=1` porque listar cliente devolve dado de
 * terceiro sem necessidade; a sonda precisa de um status, não de um corpo.
 */
const CAMINHO_DA_SONDA = '/myAccount/commercialInfo'

/**
 * Uma vez por dia, prova que este app consegue falar com o Asaas — e mantém a
 * chave viva.
 *
 * ## As duas razões, e a segunda não é óbvia
 *
 * **Medir.** Em 27/11/2026 a chave de homologação estava gravada e inútil — um
 * valor marcador posto ali só para o `bindings.secret()` deixar o deploy passar.
 * Ninguém soube por semanas, porque o sintoma só aparece quando alguém tenta
 * contratar, e em staging ninguém tenta. A sonda não depende de tráfego: ela
 * **produz** o tráfego.
 *
 * **Manter viva.** O Asaas desabilita a chave aos **3 meses** sem uso e a expira
 * em definitivo aos 6, sem reativação possível (o relógio inteiro está em
 * `lib/asaas/sonda.ts`). Uma chamada autenticada por dia reinicia esse relógio.
 * Então esta rotina não é só um detector — ela é a razão pela qual o defeito que
 * ela detecta não vai acontecer por inatividade.
 *
 * E é por isso que ela roda **inclusive em homologação**, que é justamente o
 * ambiente que fica ocioso.
 *
 * ## Não debita nada e não registra uso
 *
 * Não passa por `spendAiCredits` nem por `usage_logs`: é custo nosso de
 * operação, não uso de cliente, e uma linha diária de sonda sujaria a tabela que
 * mede margem.
 *
 * ## Sem estado, e sem aviso de retorno
 *
 * Diária, então a falha rende um e-mail por dia enquanto durar, e a volta se
 * anuncia pelo e-mail que **não** chega. Mesma escolha da sonda de IA, pela
 * mesma razão: fechar um par queda/retorno exigiria uma linha de banco para um
 * par que ninguém precisa ver. Credencial não se cura sozinha.
 */
export async function runAsaasCredencial(): Promise<void> {
    const veredito = await sondar()

    if (veredito.estado === 'ok') {
        log.info(`credencial do Asaas ok (${await hostDaSonda()}${CAMINHO_DA_SONDA})`)
        return
    }

    if (!mereceAviso(veredito)) {
        // 429 e 5xx são passageiros, e a sonda roda de novo amanhã. Fica no log
        // para quem for investigar, e não no e-mail de quem está dormindo.
        log.warn(`sonda do Asaas inconclusiva: ${descrever(veredito)}`)
        return
    }

    log.error(`credencial do Asaas com problema: ${descrever(veredito)}`)
    await avisar(veredito)
}

/**
 * A chamada de rede, isolada — e **sem** passar pelo `asaas()` de
 * `lib/asaas/client.ts`.
 *
 * Aquele helper lança `AsaasError` e entrega o corpo já reduzido a uma
 * mensagem; a sonda precisa do **status cru e do corpo cru**, porque é o corpo
 * que separa `invalid_environment` de `invalid_access_token`. Reusar o helper
 * obrigaria a reparsear a frase que ele montou — adivinhar o que já se tinha na
 * mão.
 *
 * `asaasConfig()` continua vindo dele: é lá que mora a derivação do ambiente
 * pelo prefixo da chave, e duplicá-la aqui criaria um segundo lugar onde "qual
 * URL" se decide — exatamente o que aquele arquivo existe para impedir.
 */
async function sondar(): Promise<Veredito> {
    const cfg = await asaasConfig()
    if (!cfg) return { estado: 'sem-chave' }

    try {
        const resposta = await fetch(`${cfg.base}${CAMINHO_DA_SONDA}`, {
            headers: {
                'Content-Type': 'application/json',
                access_token: cfg.chave,
            },
        })

        /**
         * O corpo é lido **só** quando houve falha.
         *
         * Em 200 ele traz os dados comerciais da nossa conta Asaas — documento,
         * endereço, faturamento — e a sonda não precisa de nada disso. Ler e
         * descartar seria carregar dado cadastral para dentro de uma rotina que
         * só quer saber se o 200 veio.
         */
        const corpo = resposta.ok ? '' : (await resposta.text()).slice(0, 400)
        return julgar(resposta.status, corpo)
    } catch (erro) {
        /**
         * Rede caída não é credencial quebrada.
         *
         * `indisponivel` com status 0 faz `mereceAviso` devolver `false`, que é
         * o que se quer: um `fetch` que nem completou não prova nada sobre a
         * chave, e avisar por isso seria o falso positivo que esvazia o alerta.
         */
        return { estado: 'indisponivel', status: 0, detalhe: String(erro).slice(0, 200) }
    }
}

function descrever(v: Veredito): string {
    return v.estado === 'sem-chave'
        ? 'nenhuma chave legível (cofre vazio, valor em branco ou prefixo irreconhecível)'
        : v.estado === 'ok'
          ? 'ok'
          : `${v.estado} (${v.status}) ${v.detalhe}`
}

/** O host que a sonda chamou — e ele **é** a prova de qual ambiente respondeu. */
async function hostDaSonda(): Promise<string> {
    const cfg = await asaasConfig()
    if (!cfg) return '(sem chave)'
    try {
        return `${new URL(cfg.base).host} (${cfg.ambiente})`
    } catch {
        return '(base inválida)'
    }
}

/**
 * O e-mail sai por `avisarSuporte`, que é o mesmo caminho do webhook de chave.
 *
 * Uma chave desabilitada por inatividade chega por **dois** canais — o evento
 * `ACCESS_TOKEN_DISABLED` hoje, a sonda amanhã — e os dois têm de descrever o
 * mesmo incidente com as mesmas palavras. Duas composições de HTML divergiriam
 * na primeira correção.
 */
async function avisar(veredito: VereditoComAviso): Promise<void> {
    try {
        await avisarSuporte({
            assunto: assuntoDoAviso(veredito, nomeDoWorker()),
            passos: comoConsertar(veredito, nomeDoWorker()),
            campos: {
                Caminho: `${await hostDaSonda()}${CAMINHO_DA_SONDA}`,
                Resposta:
                    veredito.estado === 'sem-chave'
                        ? 'nenhuma chave legível'
                        : `${veredito.status} — ${veredito.detalhe}`,
            },
        })
        log.warn('suporte avisado da falha de credencial do Asaas')
    } catch (erro) {
        log.error(`não consegui avisar a falha de credencial do Asaas: ${String(erro)}`)
    }
}
