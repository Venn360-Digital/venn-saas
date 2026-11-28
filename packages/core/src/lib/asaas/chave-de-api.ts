import { CONSEQUENCIA_SEM_CREDENCIAL, nomeDoWorker, type AlertaDoAsaas } from './alerta'

/**
 * Os eventos de chave de API do Asaas, e qual deles acorda alguém.
 *
 * ## Por que assinar estes eventos
 *
 * Porque a chave **morre de não ser usada**, e o Asaas avisa antes — mas avisa
 * por e-mail para o titular da conta Asaas, que não é quem opera o Worker. O
 * webhook é o único canal que chega a quem pode consertar.
 *
 * O relógio deles, da documentação: desabilitada aos **3 meses** de inatividade,
 * avisos aos 4, aos 5 e a ~1 semana do fim, e **expirada em definitivo aos 6**,
 * sem reativação possível. A sonda diária (`cron/asaas-credencial.ts`) existe
 * para que esse relógio nunca chegue ao fim; estes eventos existem para o caso
 * de ele chegar — porque sonda que para de rodar também não avisa que parou.
 *
 * ## A divisão entre os seis
 *
 * Três **acordam alguém**, porque a integração está morta ou com data marcada:
 * `ACCESS_TOKEN_DISABLED`, `ACCESS_TOKEN_EXPIRED` e `ACCESS_TOKEN_EXPIRING_SOON`.
 *
 * Três **só vão para o log**. `CREATED` e `ENABLED` são notícia boa, e alerta
 * de notícia boa é o que ensina a filtrar o remetente. `DELETED` é ação
 * deliberada de alguém com acesso ao painel — se foi a nossa chave, a sonda
 * acusa no dia seguinte com o diagnóstico certo; avisar aqui diria "alguém
 * apagou uma chave" sem saber se era a nossa.
 *
 * ## `disableReason` muda o texto, não a gravidade
 *
 * `LACK_OF_USE` e `MANUAL` acabam no mesmo lugar — 401 em toda chamada —, mas o
 * conserto é diferente: inatividade se reabilita no painel, e desativação manual
 * normalmente significa que alguém quis desativar e precisa saber que isso
 * parou as cobranças.
 */

/** O que o Asaas manda em `accessToken`, pelos campos documentados. */
export interface ChaveNoEvento {
    id?: string
    name?: string
    enabled?: boolean
    /** `MANUAL` ou `LACK_OF_USE`. */
    disableReason?: string
    /** Expiração configurada à mão, quando houver. */
    expirationDate?: string
    /** A projeção por inatividade — é esta que dá a data no aviso. */
    projectedExpirationDateByLackOfUse?: string
}

/** Os três que viram e-mail. */
const ACORDAM = new Set([
    'ACCESS_TOKEN_DISABLED',
    'ACCESS_TOKEN_EXPIRED',
    'ACCESS_TOKEN_EXPIRING_SOON',
])

export function eventoDeChave(event: string): boolean {
    return event.startsWith('ACCESS_TOKEN_')
}

/**
 * O alerta que este evento merece, ou `null` quando ele só vai para o log.
 *
 * Pura: recebe o evento e o objeto do payload e devolve texto. Quem manda
 * e-mail é o processador, e quem decide **se** manda é esta função — poder
 * exercitar os seis casos sem webhook, sem rede e sem caixa de entrada é o que
 * permite provar que `CREATED` não acorda ninguém.
 */
export function alertaDaChave(event: string, chave: ChaveNoEvento): AlertaDoAsaas | null {
    if (!ACORDAM.has(event)) return null

    const worker = nomeDoWorker()
    const apelido = chave.name?.trim() || chave.id || '(sem nome)'
    const porInatividade = chave.disableReason === 'LACK_OF_USE'

    const campos: Record<string, string> = { Chave: apelido, Evento: event }
    if (chave.disableReason) campos['Motivo'] = chave.disableReason
    if (chave.projectedExpirationDateByLackOfUse) {
        campos['Expira por inatividade em'] = chave.projectedExpirationDateByLackOfUse
    }
    if (chave.expirationDate) campos['Expiração configurada'] = chave.expirationDate

    if (event === 'ACCESS_TOKEN_EXPIRING_SOON') {
        return {
            assunto: 'A chave do Asaas vai expirar',
            passos: [
                `O Asaas avisou que a chave <strong>${apelido}</strong> está perto de ` +
                    `expirar por inatividade. Ela <strong>ainda funciona</strong> — isto é ` +
                    `aviso, não incidente.`,
                `A sonda diária existe para que isto não aconteça. Se este e-mail chegou, ` +
                    `vale conferir se o cron <code>asaas-credencial</code> está rodando no ` +
                    `Worker <strong>${worker}</strong>: uma chamada autenticada por dia ` +
                    `reinicia o relógio.`,
                `Se a sonda estiver de pé e o aviso insistir, a chave que ela usa não é ` +
                    `esta — duas chaves na mesma conta Asaas, e só uma sendo exercitada.`,
            ],
            campos,
        }
    }

    if (event === 'ACCESS_TOKEN_EXPIRED') {
        return {
            assunto: 'A chave do Asaas expirou em definitivo',
            passos: [
                `A chave <strong>${apelido}</strong> expirou e <strong>não pode ser ` +
                    `reativada</strong> — é o fim do relógio de 6 meses de inatividade.`,
                CONSEQUENCIA_SEM_CREDENCIAL,
                `Conserto: gerar uma chave nova no painel do Asaas e gravá-la com ` +
                    `<code>npx wrangler secret put PLATFORM_ASAAS_CLIENT_ID --name ` +
                    `${worker}</code>. Confira o prefixo: <code>$aact_hmlg_</code> para ` +
                    `homologação, <code>$aact_prod_</code> para produção.`,
            ],
            campos,
        }
    }

    return {
        assunto: porInatividade
            ? 'A chave do Asaas foi desabilitada por inatividade'
            : 'A chave do Asaas foi desabilitada',
        passos: [
            porInatividade
                ? `A chave <strong>${apelido}</strong> ficou 3 meses sem uso e o Asaas a ` +
                  `desabilitou. Toda chamada passa a responder 401. Aos 6 meses ela expira ` +
                  `em definitivo, e aí não há reativação.`
                : `A chave <strong>${apelido}</strong> foi desabilitada no painel do Asaas. ` +
                  `Se foi você, saiba o efeito: toda chamada passa a responder 401.`,
            CONSEQUENCIA_SEM_CREDENCIAL,
            porInatividade
                ? `Conserto: reabilitar em Integrações → Chaves de API, e conferir se o cron ` +
                  `<code>asaas-credencial</code> está rodando no Worker ` +
                  `<strong>${worker}</strong> — é ele que impede a inatividade.`
                : `Conserto: reabilitar em Integrações → Chaves de API, ou gravar outra com ` +
                  `<code>npx wrangler secret put PLATFORM_ASAAS_CLIENT_ID --name ${worker}</code>.`,
        ],
        campos,
    }
}
