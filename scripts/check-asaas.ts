/**
 * Prova das decisões da integração com o Asaas.
 *
 * Três módulos puros carregam decisões que, erradas, só aparecem em produção:
 * qual resposta do gateway vira incidente (`lib/asaas/sonda.ts`), qual evento de
 * chave de API acorda alguém (`lib/asaas/chave-de-api.ts`), e se o texto do
 * provedor é escapado antes de entrar no HTML do alerta (`lib/asaas/alerta.ts`).
 *
 * Nenhuma delas precisa de rede, de banco ou de chave — e é por isso que foram
 * separadas das chamadas desde o início. Um teste que exigisse o sandbox nunca
 * rodaria no portão, e a decisão continuaria sem prova.
 *
 *     npm run check:asaas
 *
 * ## O que este script NÃO cobre, e por quê
 *
 * A criação de cobrança (`cobranca-no-pix.ts`, `cobranca-no-cartao.ts`,
 * `checkout.ts`) e a entrega pelo webhook (`asaas-event.ts`) falam com o Prisma
 * e com o Asaas. Provar aquilo pede banco, e está no roteiro de homologação, não
 * aqui. O que mora aqui é o que é **função de entrada para saída**.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import { julgar, mereceAviso, assuntoDoAviso, comoConsertar } from '@venn/core/lib/asaas/sonda'
import { alertaDaChave, eventoDeChave } from '@venn/core/lib/asaas/chave-de-api'
import { escapar, sufixoDoWorker } from '@venn/core/lib/asaas/alerta'

/** Os corpos de erro do Asaas têm esta forma; o código é o que importa. */
function corpoDoAsaas(code: string, description = 'texto para humano'): string {
    return JSON.stringify({ errors: [{ code, description }] })
}

function main() {
    let falhas = 0
    const ok = (nome: string, cond: boolean) => {
        console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}`)
        if (!cond) falhas++
    }

    console.log('\n— a sonda: qual resposta vira incidente\n')

    // 1. O caminho feliz, e a faixa inteira de 2xx.
    ok('200 é ok', julgar(200, '').estado === 'ok')
    ok('204 também é ok', julgar(204, '').estado === 'ok')

    /**
     * 2. Os três códigos de 401, separados — e esta é a razão de o script
     * existir.
     *
     * Eles chegam todos como 401 e pedem consertos diferentes. Confundi-los
     * manda a pessoa para o lugar errado: trocar a chave quando o problema é
     * ambiente, ou mexer no cofre quando o defeito é nosso.
     */
    ok(
        'invalid_environment é ambiente, não credencial',
        julgar(401, corpoDoAsaas('invalid_environment')).estado === 'ambiente'
    )
    ok(
        'access_token_not_found é defeito nosso (sem-header)',
        julgar(401, corpoDoAsaas('access_token_not_found')).estado === 'sem-header'
    )
    ok(
        'invalid_access_token é credencial',
        julgar(401, corpoDoAsaas('invalid_access_token')).estado === 'credencial'
    )
    ok(
        '401 sem código reconhecido cai em credencial',
        julgar(401, '{}').estado === 'credencial'
    )
    ok('403 é credencial', julgar(403, '').estado === 'credencial')

    /**
     * 3. Passageiro **não** avisa.
     *
     * A sonda roda uma vez por dia. Transformar um 503 momentâneo em e-mail de
     * incidente é como se ensina o suporte a apagar o aviso sem ler.
     */
    for (const status of [429, 500, 502, 503, 504]) {
        ok(`${status} é indisponivel`, julgar(status, '').estado === 'indisponivel')
        ok(`${status} NÃO merece aviso`, !mereceAviso(julgar(status, '')))
    }
    ok('ok NÃO merece aviso', !mereceAviso({ estado: 'ok' }))
    ok('rede caída (status 0) NÃO merece aviso', !mereceAviso(julgar(0, 'fetch failed')))

    // 4. E os quatro que avisam, avisam.
    ok('credencial merece aviso', mereceAviso(julgar(401, '{}')))
    ok('ambiente merece aviso', mereceAviso(julgar(401, corpoDoAsaas('invalid_environment'))))
    ok('sem-header merece aviso', mereceAviso(julgar(401, corpoDoAsaas('access_token_not_found'))))
    ok('sem-chave merece aviso', mereceAviso({ estado: 'sem-chave' }))

    /**
     * 5. Cada classe tem assunto e conserto **próprios**.
     *
     * Quatro assuntos iguais tornariam a separação acima decorativa: quem lê o
     * e-mail às 3 h da manhã lê o assunto e age. E o conserto do `sem-header`
     * não pode mandar mexer no cofre.
     */
    const classes = [
        julgar(401, '{}'),
        julgar(401, corpoDoAsaas('invalid_environment')),
        julgar(401, corpoDoAsaas('access_token_not_found')),
        { estado: 'sem-chave' as const },
    ].filter(mereceAviso)

    const assuntos = classes.map((v) => assuntoDoAviso(v, 'app-stg'))
    ok('os quatro assuntos são distintos', new Set(assuntos).size === 4)
    ok(
        'nenhum assunto fica vazio',
        assuntos.every((a) => a.trim().length > 10)
    )

    const consertoDoHeader = comoConsertar(
        julgar(401, corpoDoAsaas('access_token_not_found')) as never,
        'app-stg'
    ).join(' ')
    ok(
        'o conserto do sem-header diz que é código, não cofre',
        /defeito de código/.test(consertoDoHeader) && /não mexa no cofre/.test(consertoDoHeader)
    )

    const consertoDoAmbiente = comoConsertar(
        julgar(401, corpoDoAsaas('invalid_environment')) as never,
        'app-stg'
    ).join(' ')
    ok(
        'o conserto do ambiente não manda gerar chave nova',
        !/gerar uma chave nova/.test(consertoDoAmbiente)
    )

    /**
     * 6. O nome do Worker aparece no comando — e é o que impede o pior
     * desfecho de um alerta.
     *
     * Um e-mail de incidente de homologação que mandasse `--name odontobox`
     * faria o operador gravar o segredo em **produção**.
     */
    ok(
        'o conserto cita o Worker que recebeu o nome',
        comoConsertar(julgar(401, '{}') as never, 'odontobox-stg')
            .join(' ')
            .includes('odontobox-stg')
    )

    console.log('\n— os eventos de chave de API: quem acorda alguém\n')

    // 7. O reconhecimento do prefixo.
    ok('ACCESS_TOKEN_DISABLED é evento de chave', eventoDeChave('ACCESS_TOKEN_DISABLED'))
    ok('PAYMENT_CONFIRMED NÃO é evento de chave', !eventoDeChave('PAYMENT_CONFIRMED'))
    ok('CHECKOUT_PAID NÃO é evento de chave', !eventoDeChave('CHECKOUT_PAID'))

    /**
     * 8. Três acordam, três não — e o corte é o ponto todo.
     *
     * Alerta de notícia boa (`CREATED`, `ENABLED`) é o que ensina alguém a criar
     * filtro para o remetente, e aí o alerta que importa também é filtrado.
     */
    for (const e of ['ACCESS_TOKEN_DISABLED', 'ACCESS_TOKEN_EXPIRED', 'ACCESS_TOKEN_EXPIRING_SOON']) {
        ok(`${e} acorda alguém`, alertaDaChave(e, {}) !== null)
    }
    for (const e of ['ACCESS_TOKEN_CREATED', 'ACCESS_TOKEN_ENABLED', 'ACCESS_TOKEN_DELETED']) {
        ok(`${e} só vai para o log`, alertaDaChave(e, {}) === null)
    }

    // 9. `disableReason` muda o texto, porque muda o conserto.
    const porInatividade = alertaDaChave('ACCESS_TOKEN_DISABLED', {
        name: 'chave-do-worker',
        disableReason: 'LACK_OF_USE',
    })
    const manual = alertaDaChave('ACCESS_TOKEN_DISABLED', {
        name: 'chave-do-worker',
        disableReason: 'MANUAL',
    })
    ok('inatividade e manual têm assuntos diferentes', porInatividade?.assunto !== manual?.assunto)
    ok(
        'o de inatividade menciona os 3 meses',
        /3 meses/.test(porInatividade?.passos.join(' ') ?? '')
    )
    ok(
        'o de inatividade aponta para o cron que impede isso',
        /asaas-credencial/.test(porInatividade?.passos.join(' ') ?? '')
    )
    ok(
        'o expirado diz que não há reativação',
        /não pode ser reativada|não há reativação/.test(
            alertaDaChave('ACCESS_TOKEN_EXPIRED', {})?.passos.join(' ') ?? ''
        )
    )

    /**
     * 10. O `EXPIRING_SOON` não pode soar como incidente.
     *
     * A chave ainda funciona. Um e-mail que dissesse "parou de funcionar" faria
     * alguém trocar credencial de produção às pressas por um aviso.
     */
    const aviso = alertaDaChave('ACCESS_TOKEN_EXPIRING_SOON', {
        projectedExpirationDateByLackOfUse: '2027-02-27',
    })
    ok('o EXPIRING_SOON diz que ainda funciona', /ainda funciona/.test(aviso?.passos.join(' ') ?? ''))
    ok(
        'e leva a data projetada nos campos',
        Object.values(aviso?.campos ?? {}).includes('2027-02-27')
    )

    // 11. Chave sem nome não quebra o texto.
    const semNome = alertaDaChave('ACCESS_TOKEN_DISABLED', {})
    ok('chave sem nome nem id ainda produz alerta', semNome !== null)
    ok(
        'e o texto não fica com "undefined"',
        !/undefined/.test(JSON.stringify(semNome))
    )

    console.log('\n— o alerta: o texto do provedor nunca entra cru no HTML\n')

    /**
     * 12. `escapar` neutraliza o que vem do Asaas.
     *
     * O corpo de erro deles vai para `campos.Resposta`, e corpo de erro não é
     * conteúdo confiável só porque veio de uma API conhecida.
     */
    const hostil = '<script>alert("x")</script> & "aspas"'
    const escapado = escapar(hostil)
    ok('escapar remove o < do script', !escapado.includes('<script'))
    ok('escapar não deixa > solto', !escapado.includes('>'))
    ok('escapar troca & por entidade', escapado.includes('&amp;'))
    ok('escapar troca aspas', escapado.includes('&quot;') && !escapado.includes('"aspas"'))

    /**
     * Provado no sentido de falhar: uma implementação que esquecesse o `&`
     * passaria nas outras três asserções. Esta reinjeção garante que o teste
     * acima pega a omissão em vez de só documentá-la.
     */
    const semAmpersand = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    ok(
        'o teste do & reprova quem não escapa o &',
        !semAmpersand(hostil).includes('&amp;')
    )

    /**
     * 13. O nome do Worker segue o ambiente.
     *
     * Contra `sufixoDoWorker`, não contra `nomeDoWorker`: `APP()` memoiza na
     * primeira chamada, então mexer em `process.env` depois disso não muda
     * nada — a primeira versão deste teste fazia exatamente isso e reprovou,
     * que foi o que motivou extrair a regra pura. O defeito era do teste, e a
     * lição é que a regra não era conferível sem ambiente.
     */
    ok('em stg o Worker leva o sufixo', sufixoDoWorker('odontobox', 'stg') === 'odontobox-stg')
    ok('em produção o Worker é o slug puro', sufixoDoWorker('odontobox', 'production') === 'odontobox')
    ok('slug vazio não gera nome vazio', sufixoDoWorker('', 'stg') === 'app-stg')
    /**
     * E o caso que o defeito real produziria: `env` desconhecido **não** pode
     * cair em produção. Um alerta de homologação que mandasse `--name
     * odontobox` faria o operador gravar o segredo no Worker de produção.
     */
    ok('env vazio NÃO é tratado como produção', sufixoDoWorker('odontobox', '') === 'odontobox-stg')

    console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`)
    process.exit(falhas === 0 ? 0 : 1)
}

main()
