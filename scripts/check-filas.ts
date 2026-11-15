/**
 * Prova a outbox, a idempotência e a conversão de fuso dos crons.
 *
 * São as três coisas que a plataforma anterior e o BullMQ davam de graça e que a Cloudflare
 * não dá — e as três falham **em silêncio** se estiverem erradas:
 *
 *   - sem outbox, a mensagem é gravada e a tela nunca atualiza;
 *   - sem dedup, um webhook reenviado vira duas mensagens na conversa;
 *   - sem converter o fuso, o boletim das 7 h dispara às 4 h da manhã.
 *
 * Nenhuma delas acusa erro sozinha, e é por isso que o teste existe.
 *
 *     DATABASE_URL='<homologação>' npm run check:filas
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import { readFileSync } from 'node:fs'
import { resolverNoCodigo, configuracoesDeApp } from './lib/raizes-de-codigo.mjs'
import prisma from '@venn/db/cliente'
import {
    gravarEvento,
    publicarPendentes,
    podarOutbox,
    MAXIMO_DE_TENTATIVAS,
    type EventoPendente,
} from '@venn/core/lib/outbox'
import { reservar, liberar, umaVezSo, podarChaves, chaveDeIdempotencia } from '@venn/core/lib/queue/idempotencia'
import { consumirLote, exponencial, type LoteDaFila, type MensagemDaFila } from '@venn/core/lib/queue/consumidor'
import { paraUTC, rotinasEmUTC, cronsParaWrangler, rotinasDoDisparo, cronDaVarredura, TAREFA_DA_VARREDURA, PadraoNaoConversivelError, ROTINAS } from '@venn/core/lib/cron/agenda'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

const WS = `ws-prova-${Date.now()}`

async function main() {
    // ============================================================= fuso dos crons

    // Dezoito entradas para dezessete tarefas: `integration-health` tem duas,
    // uma de dia e uma de noite. Ver a tabela em `agenda.ts`.
    //
    // O número é fixo de propósito — é o que faz uma rotina acrescentada ou
    // removida aparecer aqui, e não em produção. Estava em 14 desde antes de
    // `broadcast-dispatch` entrar, e em 17 antes de `ses-verificar-remetente`;
    // nas duas vezes foi esta prova que acusou.
    ok('as 18 entradas da agenda convertem sem erro', rotinasEmUTC().length === 18)

    /**
     * A primeira rotina **semanal** do sistema, e a primeira com restrição de
     * dia.
     *
     * `paraUTC` recusa hora que cruza a meia-noite quando o padrão restringe
     * dia, porque avançar o dia da semana num campo de cron tem casos de borda
     * que não valem para um uso. Esta prova é o que impede alguém de mover a
     * mineração para a noite e descobrir em produção que ela roda na terça.
     */
    const semanal = rotinasEmUTC().find((r) => r.task === 'minerar-lacunas')
    ok(
        'a mineração é semanal, na segunda, e a conversão preserva o dia',
        semanal?.utc === '26 9 * * 1',
        semanal?.utc ?? '(ausente)'
    )

    let recusouNoite = false
    try {
        paraUTC('26 21 * * 1')
    } catch {
        recusouNoite = true
    }
    ok('e hora da noite com restrição de dia é RECUSADA, não meio-convertida', recusouNoite)

    // Os cinco de hora fixa, um a um. Fixados de propósito: se alguém mudar o
    // deslocamento ou a tabela, é aqui que aparece — não em produção.
    const esperado: Record<string, string> = {
        'credits-reset': '13 6 * * *',
        retention: '41 7 * * *',
        'follow-up': '0 10 * * *',
        'billing-dunning': '27 8 * * *',
        'billing-reconcile': '47 8 * * *',
    }
    /**
     * Multimapa, e não `Map<task, utc>`.
     *
     * Uma tarefa pode ter mais de um horário desde 2026-10-23, e um `Map`
     * simples guardaria só o último — o teste passaria olhando a entrada
     * errada. Aqui a asserção é sobre o conjunto.
     */
    const emUtc = new Map<string, string[]>()
    for (const r of rotinasEmUTC()) {
        emUtc.set(r.task, [...(emUtc.get(r.task) ?? []), r.utc])
    }
    for (const [task, utc] of Object.entries(esperado)) {
        const horarios = emUtc.get(task) ?? []
        ok(
            `${task} dispara às ${utc} UTC`,
            horarios.length === 1 && horarios[0] === utc,
            horarios.join(' | ')
        )
    }

    // As de hora curinga não podem mudar: "toda hora" é toda hora em qualquer fuso.
    const curingas = ROTINAS.filter((r) => r.brt.split(' ')[1].includes('*'))
    ok(
        'rotinas de hora curinga ficam intactas',
        curingas.every((r) => paraUTC(r.brt) === r.brt),
        `${curingas.length} rotinas`
    )

    /**
     * Intervalo de horas: converte quando é demonstrável, recusa quando não é.
     *
     * Até 2026-10-23 TODO intervalo era recusado, e a recusa estava certa pelo
     * motivo certo — "1-5" deslocado vira "4-8", um intervalo diferente e ainda
     * válido, e meio-converter produz um horário plausível e errado. O que
     * mudou é o recorte: quando `fim + 3 <= 23` o intervalo inteiro cabe no
     * mesmo dia UTC e a conversão é hora a hora. Fora disso a recusa continua.
     */
    ok(
        'intervalo de horas que não cruza a meia-noite converte',
        paraUTC('* 7-20 * * *') === '* 10-23 * * *',
        paraUTC('* 7-20 * * *')
    )
    ok(
        'intervalo de horas desloca como hora fixa',
        paraUTC('0 1-5 * * *') === '0 4-8 * * *',
        paraUTC('0 1-5 * * *')
    )

    // E o que a função NÃO sabe converter tem de recusar, não chutar.
    for (const [rotulo, padrao] of [
        ['intervalo que cruza a meia-noite em UTC', '0 22-23 * * *'],
        ['intervalo invertido', '0 20-7 * * *'],
        ['intervalo de horas com restrição de dia', '0 7-20 * * 1'],
        ['lista de horas', '0 1,5 * * *'],
        ['campos a menos', '0 7 * *'],
        ['hora inválida', '0 99 * * *'],
        ['cruza a meia-noite com dia da semana', '0 22 * * 1'],
    ] as const) {
        try {
            paraUTC(padrao)
            ok(`recusa o que não sabe converter: ${rotulo}`, false, 'não lançou')
        } catch (e) {
            ok(`recusa o que não sabe converter: ${rotulo}`, e instanceof PadraoNaoConversivelError)
        }
    }

    ok('nenhum trigger repetido na configuração', cronsParaWrangler().length === new Set(cronsParaWrangler()).size)

    /**
     * A guarda contra divergência — mudou de forma, e para melhor.
     *
     * Enquanto a configuração era `wrangler.jsonc`, os padrões em UTC estavam
     * **duplicados**: a agenda os gerava e o JSON os repetia. A guarda comparava
     * os dois, porque a divergência não daria erro — valeria o JSON, e a tabela
     * do código passaria a ser ficção. Provei a guarda introduzindo a regressão
     * exata que ela pegava.
     *
     * Com `cloudflare.config.ts` a duplicação **deixou de existir**: a
     * configuração é TypeScript e chama `cronsParaWrangler()` direto. Não há
     * duas listas para divergir.
     *
     * O que sobra para guardar é o que alguém ainda pode fazer: substituir a
     * chamada por uma lista literal — "só para ver", ou para ajustar um horário
     * sem mexer na agenda. Então o teste confere que a chamada está lá, e que
     * não há padrão de hora fixa escrito à mão no arquivo.
     */
    /*
     * TODOS os configs, não o primeiro.
     *
     * Era `configuracoesDeApp(...)[0]`, e com um app só dava no mesmo. Com dois
     * passaria a verificar um e **ignorar o outro em silêncio** — a forma de
     * falso verde que mais apareceu nesta fase. O helper já devolve a lista.
     */
    for (const caminho of configuracoesDeApp('cloudflare.config.ts')) {
        const config = readFileSync(caminho, 'utf8')
        ok(
            `${caminho}: gera os crons pela agenda, não os lista à mão`,
            /cronsParaWrangler\(/.test(config),
            'com argumento desde 2026-11-07: a agenda de homologação é menor'
        )
        ok(
            `${caminho}: não há padrão de hora fixa escrito literalmente`,
            !/triggers\.scheduled\(\{\s*schedule:\s*['"`]\d/.test(config),
            'um `schedule: "13 3 ..."` literal escaparia da conversão de fuso'
        )
    }

    /**
     * A varredura da outbox precisa de um gatilho que EXISTA.
     *
     * `agendado.ts` compara `event.cron` com o padrão da varredura para decidir
     * se roda. Enquanto esse padrão era um literal `'* * * * *'` escrito lá,
     * mudar o horário na agenda faria a comparação ser sempre falsa e a
     * varredura parar por completo — sem erro, sem log, sem nada. Foi o que
     * quase aconteceu ao restringir o cron para o Neon poder suspender de
     * madrugada.
     *
     * Este teste é a rede: o padrão tem de estar entre os gatilhos publicados.
     */
    {
        const daVarredura = cronDaVarredura()
        ok(
            'a varredura da outbox tem um gatilho publicado em produção',
            cronsParaWrangler('production').includes(daVarredura),
            daVarredura
        )

        /**
         * **Em homologação ela NÃO tem gatilho, e isso é deliberado.**
         *
         * A regra de ambiente derruba o que dispara mais de uma vez por dia, e
         * a varredura pega carona no `*​/10` — então ela cai junto. Fica
         * afirmado aqui, e não só comentado, porque é exactamente a forma de
         * falha que o teste de baixo existe para pegar: gatilho que não existe
         * faz `agendado.ts` nunca casar o `event.cron` e a varredura para em
         * silêncio.
         *
         * Em homologação isso é aceitável — `publicarAgora` continua imediato e
         * a varredura é a rede, não o caminho. Em produção não seria, e é por
         * isso que o teste acima existe separado.
         *
         * Se um dia homologação precisar da varredura, o conserto não é afrouxar
         * a regra: é dar à tarefa dela um horário de uma vez por dia.
         */
        ok(
            'e em homologação ela não tem — de propósito, porque é a rede e não o caminho',
            !cronsParaWrangler('stg').includes(daVarredura),
            'publicarAgora segue imediato lá'
        )
        ok(
            'e esse gatilho despacha a rotina de que ela pega carona',
            rotinasDoDisparo(daVarredura).includes(TAREFA_DA_VARREDURA),
            rotinasDoDisparo(daVarredura).join(', ')
        )
    }

    /**
     * **A linha caída continua sendo curada de madrugada.**
     *
     * `integration-health` é a rotina que reata a linha de WhatsApp sozinha (um
     * `connect` pelo JID guardado). Restringi-la à janela da clínica junto com
     * as outras deixaria a linha que cai às 21 h fora do ar até as 7 h — e o
     * sintoma seria a clínica abrir sem WhatsApp, não um erro no log. Por isso
     * ela tem duas entradas, e esta é a prova de que a de madrugada não
     * desapareceu numa arrumação futura.
     */
    {
        const horarios = ROTINAS.filter((r) => r.task === 'integration-health')
        const noturno = horarios.find((r) => r.brt.split(' ')[1] === '*')
        ok(
            'a verificação de integração tem uma passada de madrugada',
            noturno !== undefined,
            horarios.map((r) => r.brt).join(' | ')
        )

        /**
         * E ela acorda o compute **junto** com o boletim, não depois dele.
         *
         * Os dois são de hora em hora, 24 h. Em minutos diferentes seriam dois
         * despertares do Neon por hora da madrugada em vez de um — o dobro do
         * custo pelo mesmo trabalho. Mesmo padrão, um gatilho só.
         */
        const boletim = ROTINAS.find((r) => r.task === 'daily-briefing')
        ok(
            'e ela divide o gatilho com o boletim, para um despertar só por hora',
            noturno !== undefined && boletim !== undefined && noturno.brt === boletim.brt,
            `${noturno?.brt} vs ${boletim?.brt}`
        )
    }

    /**
     * **O boletim fica 24 h, e o teste existe para que continue.**
     *
     * Ele é entregue na hora que cada clínica escolheu, e o seletor em Conta →
     * Automações oferece as 24. Restringir este cron à janela da clínica
     * tiraria o boletim de quem configurou 6 h ou 22 h — em silêncio, sem erro
     * em lugar nenhum. É a armadilha mais fácil de cair ao "terminar" a
     * economia de CU-hora, então ela está presa aqui.
     */
    {
        const boletim = ROTINAS.find((r) => r.task === 'daily-briefing')
        ok(
            'o boletim roda em todas as horas (a clínica escolhe qual)',
            boletim?.brt.split(' ')[1] === '*',
            boletim?.brt
        )
    }

    /**
     * **A janela do envio automático é a mesma no cron e no código.**
     *
     * `auto-follow-up.ts` sai antes de qualquer consulta fora de
     * `BUSINESS_START`–`BUSINESS_END`, e o cron foi estreitado para não gastar
     * invocação à toa. Os dois têm de andar juntos: o cron mais largo volta a
     * desperdiçar, e o cron mais estreito **deixa de enviar numa hora que a
     * clínica autorizou** — este é o lado que machuca.
     */
    {
        const fonte = readFileSync(resolverNoCodigo('trabalhos/processadores/cron/auto-follow-up.ts'), 'utf8')
        const inicio = fonte.match(/BUSINESS_START\s*=\s*(\d+)/)?.[1]
        const fim = fonte.match(/BUSINESS_END\s*=\s*(\d+)/)?.[1]
        const rotina = ROTINAS.find((r) => r.task === 'auto-follow-up')

        // `BUSINESS_END` é exclusivo (`hour >= BUSINESS_END` sai), então a
        // última hora que envia é `BUSINESS_END - 1`.
        const esperada = `${inicio}-${Number(fim) - 1}`
        ok(
            'o envio automático dispara exatamente nas horas que o código aceita',
            rotina?.brt.split(' ')[1] === esperada,
            `cron ${rotina?.brt.split(' ')[1]} vs código ${esperada}`
        )
    }

    // ================================================================== outbox

    // O ponto inteiro: o evento nasce DENTRO da transação do dado.
    const conta = await prisma.account.create({ data: { name: 'Conta da Prova de Filas' } })
    const ws = await prisma.workspace.create({
        data: { name: 'Prova de Filas', slug: WS, accountId: conta.id },
    })

    const r = await prisma.$transaction(async (tx) => {
        const contato = await tx.contact.create({
            data: { workspaceId: ws.id, name: 'Paciente da Prova' },
        })
        await gravarEvento(tx, {
            workspaceId: ws.id,
            tipo: 'mensagem.nova',
            payload: { contactId: contato.id, conversationId: 'conv-1' },
        })
        return contato
    })
    ok('evento gravado na mesma transação do dado', r.id.length > 0)

    const pendentes = await prisma.outboxEvent.count({ where: { workspaceId: ws.id, publishedAt: null } })
    ok('evento fica pendente até ser publicado', pendentes === 1, `${pendentes}`)

    // E se a transação reverter, o evento some junto — é isso que "atômico" quer dizer.
    try {
        await prisma.$transaction(async (tx) => {
            await tx.contact.create({ data: { workspaceId: ws.id, name: 'Vai Reverter' } })
            await gravarEvento(tx, {
                workspaceId: ws.id,
                tipo: 'conversa.alterada',
                payload: { conversationId: 'conv-revertida' },
            })
            throw new Error('revertendo de propósito')
        })
    } catch {
        /* esperado */
    }
    const revertido = await prisma.outboxEvent.count({
        where: { workspaceId: ws.id, tipo: 'conversa.alterada' },
    })
    ok('transação revertida NÃO deixa evento órfão', revertido === 0, `${revertido}`)

    // Publicação: o entregador é injetado, então isto roda sem Cloudflare.
    let entregues: EventoPendente[] = []
    const res = await publicarPendentes(async (ev) => {
        entregues = ev
    })
    /**
     * As asserções são sobre os eventos **desta prova**, não sobre a outbox
     * inteira — e isso é correção, não frouxidão.
     *
     * `publicarPendentes` varre a outbox toda, e a branch de CI é criada por
     * copy-on-write a partir da branch do Neon que a produção usa. Logo
     * qualquer evento pendente em produção no instante da cópia entra na
     * varredura. O teste exigia `res.publicados === 1` e indexava
     * `entregues[0]`, então ele dependia de a produção estar com a outbox
     * vazia — condição que ninguém controla.
     *
     * Reprovou pela primeira vez em 2026-10-24: uma conversa de WhatsApp
     * minutos antes deixou um evento pendente, a cópia o herdou, e três
     * asserções caíram com `{"lidos":2,"publicados":2}`. Não havia defeito
     * nenhum no código sob teste.
     *
     * Esse é o pior tipo de reprovação: ela ensina a reexecutar até passar, e
     * um portão que se aprende a ignorar não é portão. O número global segue na
     * mensagem, para diagnóstico.
     */
    const meus = entregues.filter((e) => e.workspaceId === ws.id)

    ok(
        'publicou o pendente desta prova',
        meus.length === 1,
        `desta prova=${meus.length}, na outbox toda=${JSON.stringify(res)}`
    )
    ok('o entregador recebeu o evento', meus.length === 1)
    ok(
        'o payload carrega identificador, não conteúdo',
        meus.length === 1 &&
            JSON.stringify(meus[0].payload).includes('conv-1') &&
            !JSON.stringify(meus[0].payload).includes('Paciente')
    )

    const aindaPendente = await prisma.outboxEvent.count({ where: { workspaceId: ws.id, publishedAt: null } })
    ok('marcado como publicado depois da entrega', aindaPendente === 0)

    // Segunda passada não reentrega o que já saiu.
    let segunda = 0
    await publicarPendentes(async (ev) => {
        // Pelo mesmo motivo de `meus` acima: evento de outra unidade que a
        // cópia herdou não é reentrega do nosso.
        segunda = ev.filter((e) => e.workspaceId === ws.id).length
    })
    ok('não reentrega o já publicado', segunda === 0)

    // Falha do entregador: conta a tentativa e NÃO marca como publicado.
    await prisma.$transaction(async (tx) => {
        await gravarEvento(tx, {
            workspaceId: ws.id,
            tipo: 'agente.status',
            payload: { agentId: 'ag-1', estado: 'conectado' },
        })
    })
    const falhou = await publicarPendentes(async () => {
        throw new Error('fila fora do ar')
    })
    ok('falha não marca como publicado', falhou.publicados === 0, JSON.stringify(falhou))

    const comTentativa = await prisma.outboxEvent.findFirst({
        where: { workspaceId: ws.id, tipo: 'agente.status' },
        select: { tentativas: true, ultimoErro: true, publishedAt: true },
    })
    ok('a tentativa foi contada', comTentativa?.tentativas === 1, `${comTentativa?.tentativas}`)
    ok('o motivo foi registrado', comTentativa?.ultimoErro === 'fila fora do ar', comTentativa?.ultimoErro ?? '')
    ok('segue pendente para a próxima varredura', comTentativa?.publishedAt === null)

    // E depois de insistir demais, para de ser lido — sem ser apagado.
    await prisma.outboxEvent.updateMany({
        where: { workspaceId: ws.id, tipo: 'agente.status' },
        data: { tentativas: MAXIMO_DE_TENTATIVAS },
    })
    let desistido = 0
    await publicarPendentes(async (ev) => {
        desistido = ev.filter((e) => e.workspaceId === ws.id).length
    })
    ok('para de insistir no máximo de tentativas', desistido === 0)
    ok(
        'mas o evento desistido NÃO é apagado',
        (await prisma.outboxEvent.count({ where: { workspaceId: ws.id, tipo: 'agente.status' } })) === 1
    )

    // A poda leva o publicado velho e preserva o recente.
    await prisma.outboxEvent.updateMany({
        where: { workspaceId: ws.id, publishedAt: { not: null } },
        data: { publishedAt: new Date(Date.now() - 48 * 3600_000) },
    })
    const poda = await podarOutbox({ horas: 6, horasDeFalha: 72 })
    ok('a poda apaga o publicado velho', poda.apagados >= 1, `${poda.apagados}`)
    ok(
        'e preserva o que falhou, pelo ultimoErro',
        (await prisma.outboxEvent.count({ where: { workspaceId: ws.id, tipo: 'agente.status' } })) === 1
    )

    // ============================================================ idempotência

    const idExterno = `wamid-${Date.now()}`
    ok('primeira reserva passa', await reservar('whatsapp-inbound', idExterno))
    ok('segunda reserva é recusada', !(await reservar('whatsapp-inbound', idExterno)))

    // A fila entra na chave: o mesmo id em fila diferente é outro trabalho.
    ok('mesmo id em outra fila é permitido', await reservar('whatsapp-event', idExterno))
    ok(
        'a chave carrega a fila',
        chaveDeIdempotencia('whatsapp-inbound', idExterno) === `whatsapp-inbound:${idExterno}`
    )

    // Liberar permite a retentativa — é o que evita a mensagem morrer em silêncio.
    await liberar('whatsapp-inbound', idExterno)
    ok('liberar permite reprocessar', await reservar('whatsapp-inbound', idExterno))

    // `umaVezSo`: executa uma vez, e no erro libera sozinho.
    const idUm = `uma-vez-${Date.now()}`
    let execucoes = 0
    const a = await umaVezSo('ai-reply', idUm, async () => {
        execucoes++
        return 'feito'
    })
    const b = await umaVezSo('ai-reply', idUm, async () => {
        execucoes++
        return 'feito'
    })
    ok('umaVezSo executa na primeira', a.executou && a.resultado === 'feito')
    ok('e não executa na segunda', !b.executou)
    ok('o trabalho correu uma vez só', execucoes === 1, `${execucoes}`)

    const idErro = `com-erro-${Date.now()}`
    try {
        await umaVezSo('ai-reply', idErro, async () => {
            throw new Error('falhou')
        })
    } catch {
        /* esperado */
    }
    ok(
        'no erro, umaVezSo libera a chave para a retentativa',
        await reservar('ai-reply', idErro)
    )

    // Poda das chaves vencidas.
    await prisma.processedMessage.updateMany({
        where: { chave: { contains: idExterno } },
        data: { expiraEm: new Date(Date.now() - 1000) },
    })
    const podaChaves = await podarChaves()
    ok('a poda apaga chave vencida', podaChaves.apagadas >= 1, `${podaChaves.apagadas}`)

    // ====================================================== disciplina de consumo

    /**
     * Um lote de mentira que registra o que foi pedido.
     *
     * É o que permite provar a disciplina de `ack`/`retry` sem Cloudflare — e é
     * justamente ela que o `workerd` me impediria de verificar nesta máquina.
     */
    type Registro = { acks: number; retries: Array<number | undefined> }
    function loteFalso<T>(corpos: T[], tentativas = 1): { lote: LoteDaFila<T>; reg: Registro } {
        const reg: Registro = { acks: 0, retries: [] }
        const messages: MensagemDaFila<T>[] = corpos.map((body) => ({
            body,
            attempts: tentativas,
            ack: () => { reg.acks++ },
            retry: (o) => { reg.retries.push(o?.delaySeconds) },
        }))
        return { lote: { messages }, reg }
    }

    // Sucesso: confirma, não repete.
    {
        const { lote, reg } = loteFalso([{ eventRowId: 'a' }, { eventRowId: 'b' }])
        const r = await consumirLote(lote, { fila: 'asaas-event', processar: async () => {} })
        ok('sucesso confirma cada mensagem', reg.acks === 2 && reg.retries.length === 0)
        ok('e conta os confirmados', r.confirmados === 2, JSON.stringify(r))
    }

    // Falha: repete, não confirma.
    {
        const { lote, reg } = loteFalso([{ eventRowId: 'c' }])
        const r = await consumirLote(lote, {
            fila: 'asaas-event',
            processar: async () => { throw new Error('falhou') },
        })
        ok('falha pede retentativa', reg.retries.length === 1)
        ok('e NÃO confirma', reg.acks === 0)
        ok('e conta os retentados', r.retentados === 1)
    }

    /**
     * Uma falha no meio do lote não leva as outras.
     *
     * É o motivo de não usar `batch.ackAll()`: ele é mais curto e confirmaria o
     * lote inteiro quando uma mensagem no meio falhasse — nove processadas e uma
     * perdida, sem sintoma nenhum.
     */
    {
        const { lote, reg } = loteFalso([{ eventRowId: '1' }, { eventRowId: '2' }, { eventRowId: '3' }])
        await consumirLote(lote, {
            fila: 'asaas-event',
            processar: async (p) => {
                if (p.eventRowId === '2') throw new Error('só a do meio')
            },
        })
        ok('falha no meio do lote não perde as outras', reg.acks === 2 && reg.retries.length === 1)
    }

    // Dedup: a repetição é confirmada SEM reprocessar.
    {
        const idWa = `wamid-consumo-${Date.now()}`
        const corpo = { provider: 'evolution-go' as const, inbound: { externalId: idWa } as never, receivedAt: '' }
        let processou = 0
        const consumo = {
            fila: 'whatsapp-inbound' as const,
            processar: async () => { processou++ },
            idDeDeduplicacao: () => idWa,
        }

        const a = loteFalso([corpo])
        await consumirLote(a.lote, consumo)
        const b = loteFalso([corpo])
        const r2 = await consumirLote(b.lote, consumo)

        ok('a primeira entrega processa', processou === 1)
        ok('a segunda NÃO reprocessa', processou === 1, `${processou}`)
        ok('e é confirmada, não retentada', b.reg.acks === 1 && b.reg.retries.length === 0)
        ok('contada como repetida', r2.repetidos === 1, JSON.stringify(r2))

        /**
         * A regra 3: falhar tem de liberar a chave.
         *
         * Sem isto a retentativa seria descartada como duplicada e a mensagem
         * morreria em silêncio — o defeito que o comentário de
         * `enqueue-whatsapp.ts` registra ter acontecido com uma mensagem real.
         */
        const idFalha = `wamid-falha-${Date.now()}`
        const c = loteFalso([corpo])
        await consumirLote(c.lote, {
            fila: 'whatsapp-inbound',
            processar: async () => { throw new Error('falhou') },
            idDeDeduplicacao: () => idFalha,
        })
        ok(
            'falha libera a chave para a retentativa poder rodar',
            await reservar('whatsapp-inbound', idFalha)
        )

        await prisma.processedMessage.deleteMany({ where: { fila: 'whatsapp-inbound' } })
    }

    // O backoff que o Queues não tem por configuração.
    {
        const b = exponencial(5, 300)
        ok('backoff: 1a tentativa', b(1) === 5, `${b(1)}s`)
        ok('backoff: 2a tentativa', b(2) === 10, `${b(2)}s`)
        ok('backoff: 4a tentativa', b(4) === 40, `${b(4)}s`)
        ok('backoff respeita o teto', b(20) === 300, `${b(20)}s`)

        const { lote, reg } = loteFalso([{ eventRowId: 'x' }], 3)
        await consumirLote(lote, {
            fila: 'asaas-event',
            processar: async () => { throw new Error('falhou') },
            atrasoDaRetentativa: b,
        })
        ok('o atraso calculado é o pedido', reg.retries[0] === 20, `${reg.retries[0]}s`)
    }

    // ================================================================= limpeza

    await prisma.outboxEvent.deleteMany({ where: { workspaceId: ws.id } })
    await prisma.contact.deleteMany({ where: { workspaceId: ws.id } })
    await prisma.workspace.delete({ where: { id: ws.id } })
    await prisma.account.delete({ where: { id: conta.id } })
    await prisma.processedMessage.deleteMany({
        where: { chave: { contains: String(idExterno) } },
    })
    await prisma.processedMessage.deleteMany({ where: { fila: 'ai-reply' } })
    ok('limpeza concluída', (await prisma.workspace.findFirst({ where: { slug: WS } })) === null)

    console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`)
    await prisma.$disconnect()
    process.exit(falhas === 0 ? 0 : 1)
}

void main()
