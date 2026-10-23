/**
 * Prova as decisões do canal de WhatsApp em contêiner, isoladas da plataforma.
 *
 * Nem os Durable Objects nem os Contêineres rodam nesta máquina: o `workerd`
 * exige macOS 13.5+ e este Mac está em 12.7.6, e não há Docker instalado. Então
 * a POC separa o que erra do que só obedece — as três decisões moram em
 * `poc/canal-whatsapp/src/decisoes.ts`, e são elas que este teste exercita.
 *
 * O que está coberto é exatamente o que, errado, custa uma sessão de WhatsApp:
 *
 *   - a janela do reinício pós-pareamento, cujos dois lados já foram medidos
 *     perdendo número de cliente (cedo demais: companheiro meio-registrado;
 *     tarde demais: o logout forçado dos 105 s);
 *   - a recusa de hibernar, que é o item 6 do roteiro da POC;
 *   - o vigia, que substitui dois daemons do host e tem de recusar entrar em
 *     laço de reinício.
 *
 * Não precisa de banco, de rede nem de Cloudflare:
 *
 *     npm run check:canal
 */
import {
    decidirReinicio,
    decidirOcio,
    decidirVigia,
    custoMensal,
    JANELA,
    VIGIA,
    PASSO_DE_ESPERA_MS,
} from '../poc/canal-whatsapp/src/decisoes'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

function main() {
    // ====================================================== reinício pós-par

    // Antes do piso: esperar, nunca reiniciar. Medido em 2026-10-07 — o
    // reinício cedo deixou companheiro meio-registrado e o WhatsApp o desligou
    // ~35 s depois.
    for (const t of [0, 5_000, 15_999]) {
        const d = decidirReinicio({ desdeParearMs: t, loggedIn: true, jidConhecido: true })
        ok(`reinício: ${t} ms espera mesmo com LoggedIn`, d.acao === 'esperar', d.motivo)
    }

    // A espera nunca passa do piso: senão o relógio salta a janela útil.
    const esperaNoLimite = decidirReinicio({ desdeParearMs: 14_000, loggedIn: false, jidConhecido: true })
    ok(
        'reinício: a espera não atravessa o piso',
        esperaNoLimite.acao === 'esperar' && esperaNoLimite.emMs === JANELA.PISO_MS - 14_000,
        `emMs=${esperaNoLimite.acao === 'esperar' ? esperaNoLimite.emMs : '—'}`
    )

    // Depois do piso, com login completo: é a hora.
    const naHora = decidirReinicio({ desdeParearMs: 20_000, loggedIn: true, jidConhecido: true })
    ok('reinício: 20 s com LoggedIn reinicia', naHora.acao === 'reiniciar', naHora.motivo)

    // Sem LoggedIn, dentro da janela: continua esperando, em passos.
    const aindaEsperando = decidirReinicio({ desdeParearMs: 30_000, loggedIn: false, jidConhecido: true })
    ok(
        'reinício: sem LoggedIn dentro da janela espera em passos',
        aindaEsperando.acao === 'esperar' && aindaEsperando.emMs === PASSO_DE_ESPERA_MS,
        aindaEsperando.motivo
    )

    // No teto, reinicia mesmo sem ver LoggedIn — é o que o vigia do host faz, e
    // é deliberado: `LoggedIn` ficou `false` por três minutos inteiros numa
    // medição, e guardar por ele vetaria a única ação que o tornaria verdadeiro.
    const noTeto = decidirReinicio({ desdeParearMs: JANELA.TETO_MS, loggedIn: false, jidConhecido: true })
    ok('reinício: no teto reinicia sem LoggedIn', noTeto.acao === 'reiniciar', noTeto.motivo)

    // Passado o logout forçado não há o que salvar.
    const tarde = decidirReinicio({ desdeParearMs: JANELA.LOGOUT_MS, loggedIn: true, jidConhecido: true })
    ok('reinício: depois dos 105 s desiste', tarde.acao === 'desistir', tarde.motivo)

    /**
     * **Sem JID mas logado, RECICLA** — e esta prova mudou de lado de propósito.
     *
     * Ela afirmava o contrário, e o contrário quebrava o produto: o Evolution Go
     * 0.7.2 devolve `loggedIn: true` com JID vazio, então exigir JID fazia o
     * reciclo desistir a +1 s de uma sessão viva. Medido em produção em
     * 2026-10-23: a linha pareava às 23:14, ficava no ar, e a goroutine de QR a
     * derrubava às 23:16 — sem o reciclo, que existe exatamente para matá-la.
     *
     * `loggedIn` é sinal de sessão tanto quanto o JID.
     */
    const semJid = decidirReinicio({ desdeParearMs: 20_000, loggedIn: true, jidConhecido: false })
    ok('reinício: logado sem JID ainda recicla', semJid.acao === 'reiniciar', semJid.motivo)

    // E o inverso continua valendo: sem JID e sem login não há o que retomar.
    const semSinal = decidirReinicio({ desdeParearMs: 20_000, loggedIn: false, jidConhecido: false })
    ok('reinício: sem sinal nenhum desiste', semSinal.acao === 'desistir', semSinal.motivo)

    // A ordem dos guardas importa: fora da janela E sem JID, o motivo relatado
    // deve ser a janela, que é o fato mais forte.
    const nenhumDosDois = decidirReinicio({ desdeParearMs: 200_000, loggedIn: false, jidConhecido: false })
    ok('reinício: janela fechada tem precedência', nenhumDosDois.acao === 'desistir' && /janela/.test(nenhumDosDois.motivo), nenhumDosDois.motivo)

    // Simulação completa: do PairSuccess até o reinício, em passos de 5 s, com
    // o login chegando aos 18 s. O reinício tem de cair entre o piso e o teto.
    let t = 0
    let reiniciouEm: number | null = null
    for (let i = 0; i < 40 && reiniciouEm === null; i++) {
        const d = decidirReinicio({ desdeParearMs: t, loggedIn: t >= 18_000, jidConhecido: true })
        if (d.acao === 'reiniciar') reiniciouEm = t
        else if (d.acao === 'esperar') t += d.emMs
        else break
    }
    ok(
        'reinício: simulação com login aos 18 s cai dentro da janela',
        reiniciouEm !== null && reiniciouEm >= JANELA.PISO_MS && reiniciouEm < JANELA.LOGOUT_MS,
        `reiniciou em ${reiniciouEm} ms`
    )

    // Simulação do pior caso: o login nunca é relatado. Tem de reiniciar no
    // teto, e antes do logout — é a diferença entre salvar e perder a sessão.
    t = 0
    reiniciouEm = null
    for (let i = 0; i < 40 && reiniciouEm === null; i++) {
        const d = decidirReinicio({ desdeParearMs: t, loggedIn: false, jidConhecido: true })
        if (d.acao === 'reiniciar') reiniciouEm = t
        else if (d.acao === 'esperar') t += d.emMs
        else break
    }
    ok(
        'reinício: sem LoggedIn nenhum, reinicia no teto e antes do logout',
        reiniciouEm !== null && reiniciouEm >= JANELA.TETO_MS && reiniciouEm < JANELA.LOGOUT_MS,
        `reiniciou em ${reiniciouEm} ms`
    )

    // ================================================================== ócio

    const ocioPareado = decidirOcio({ temAparelhoPareado: true, pareandoAgora: false })
    ok('ócio: sessão pareada não hiberna', ocioPareado.acao === 'permanecer', ocioPareado.motivo)

    const ocioPareando = decidirOcio({ temAparelhoPareado: false, pareandoAgora: true })
    ok('ócio: pareamento em curso não hiberna', ocioPareando.acao === 'permanecer', ocioPareando.motivo)

    // E o que paga a conta: sem sessão, dorme.
    const ocioVazio = decidirOcio({ temAparelhoPareado: false, pareandoAgora: false })
    ok('ócio: sem sessão dorme', ocioVazio.acao === 'dormir', ocioVazio.motivo)

    // ================================================================= vigia

    const vigiaVazio = decidirVigia({
        estado: 'sem-resposta',
        temAparelhoPareado: false,
        falhasSeguidas: 99,
        desdeUltimoReinicioMs: null,
    })
    ok('vigia: sem sessão não age', vigiaVazio.acao === 'nada', vigiaVazio.motivo)

    const vigiaSaudavel = decidirVigia({
        estado: 'saudavel',
        temAparelhoPareado: true,
        falhasSeguidas: 0,
        desdeUltimoReinicioMs: null,
    })
    ok('vigia: saudável não age', vigiaSaudavel.acao === 'nada', vigiaSaudavel.motivo)

    // Soquete caído é o caso barato: retoma pelo JID, sem QR e sem reinício.
    const vigiaCaido = decidirVigia({
        estado: 'socket-caido',
        temAparelhoPareado: true,
        falhasSeguidas: 1,
        desdeUltimoReinicioMs: null,
    })
    ok('vigia: soquete caído reconecta, não reinicia', vigiaCaido.acao === 'reconectar', vigiaCaido.motivo)

    // Uma ronda sem resposta pode ser rede; não reinicia.
    for (let f = 1; f < VIGIA.FALHAS_PARA_REINICIAR; f++) {
        const d = decidirVigia({
            estado: 'sem-resposta',
            temAparelhoPareado: true,
            falhasSeguidas: f,
            desdeUltimoReinicioMs: null,
        })
        ok(`vigia: ${f} falha(s) ainda não reinicia`, d.acao === 'nada', d.motivo)
    }

    const vigiaReinicia = decidirVigia({
        estado: 'sem-resposta',
        temAparelhoPareado: true,
        falhasSeguidas: VIGIA.FALHAS_PARA_REINICIAR,
        desdeUltimoReinicioMs: null,
    })
    ok('vigia: três falhas reiniciam', vigiaReinicia.acao === 'reiniciar', vigiaReinicia.motivo)

    // O teto do `wa-pool-guard.sh`: reiniciar em laço não conserta causa outra e
    // esconde o motivo. Sem este guarda a POC passaria escondendo um defeito.
    const vigiaNoTeto = decidirVigia({
        estado: 'sem-resposta',
        temAparelhoPareado: true,
        falhasSeguidas: 10,
        desdeUltimoReinicioMs: 60_000,
    })
    ok('vigia: respeita o teto de um reinício por hora', vigiaNoTeto.acao === 'nada', vigiaNoTeto.motivo)

    const vigiaPassadoOTeto = decidirVigia({
        estado: 'sem-resposta',
        temAparelhoPareado: true,
        falhasSeguidas: 10,
        desdeUltimoReinicioMs: VIGIA.MIN_ENTRE_REINICIOS_MS,
    })
    ok('vigia: passado o teto reinicia de novo', vigiaPassadoOTeto.acao === 'reiniciar', vigiaPassadoOTeto.motivo)

    // Laço de uma hora com o contêiner mudo: no máximo um reinício.
    let reinicios = 0
    let desdeReinicio: number | null = null
    for (let minuto = 0; minuto < 60; minuto += VIGIA.INTERVALO_MS / 60_000) {
        const d = decidirVigia({
            estado: 'sem-resposta',
            temAparelhoPareado: true,
            falhasSeguidas: VIGIA.FALHAS_PARA_REINICIAR,
            desdeUltimoReinicioMs: desdeReinicio,
        })
        if (d.acao === 'reiniciar') {
            reinicios++
            desdeReinicio = 0
        } else if (desdeReinicio !== null) {
            desdeReinicio += VIGIA.INTERVALO_MS
        }
    }
    ok('vigia: uma hora muda produz um reinício, não doze', reinicios === 1, `${reinicios} reinício(s)`)

    // ================================================================= custo

    // A conta não decide viabilidade — decide o modelo. Serve para o relatório,
    // e o teste só garante que ela não inverte a ordem dos cenários.
    const um = custoMensal('lite', 1)
    const dez = custoMensal('lite', 10)
    const dezBasic = custoMensal('basic', 10)
    ok('custo: dez custa mais que um', dez.total > um.total, `US$ ${um.total} → US$ ${dez.total}`)
    ok('custo: basic custa mais que lite', dezBasic.total > dez.total, `US$ ${dez.total} → US$ ${dezBasic.total}`)
    ok(
        'custo: a franquia faz o primeiro contêiner sair mais barato que o décimo',
        um.total < dez.total / 10,
        `US$ ${um.total} vs US$ ${(dez.total / 10).toFixed(2)}`
    )

    console.log('\n--- custo mensal, contêiner sempre ligado (US$) ---')
    for (const inst of ['lite', 'basic'] as const) {
        for (const n of [1, 5, 10, 25, 50]) {
            const c = custoMensal(inst, n)
            console.log(
                `  ${inst.padEnd(6)} x${String(n).padStart(3)}  ` +
                    `mem ${String(c.memoria).padStart(7)}  cpu ${String(c.cpu).padStart(6)}  ` +
                    `disco ${String(c.disco).padStart(6)}  total ${String(c.total).padStart(7)}`
            )
        }
    }

    console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} TESTE(S) FALHARAM`)
    process.exit(falhas === 0 ? 0 : 1)
}

main()
