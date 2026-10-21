/**
 * Prova a outbox, a idempotência e a conversão de fuso dos crons.
 *
 * São as três coisas que o Supabase e o BullMQ davam de graça e que a Cloudflare
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
import { readFileSync } from 'node:fs'
import prisma from '@/lib/prisma'
import {
    gravarEvento,
    publicarPendentes,
    podarOutbox,
    MAXIMO_DE_TENTATIVAS,
    type EventoPendente,
} from '@/lib/outbox'
import { reservar, liberar, umaVezSo, podarChaves, chaveDeIdempotencia } from '@/lib/queue/idempotencia'
import { consumirLote, exponencial, type LoteDaFila, type MensagemDaFila } from '@/lib/queue/consumidor'
import { paraUTC, rotinasEmUTC, cronsParaWrangler, rotinasDoDisparo, PadraoNaoConversivelError, ROTINAS } from '@/lib/cron/agenda'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

const WS = `ws-prova-${Date.now()}`

async function main() {
    // ============================================================= fuso dos crons

    ok('as 13 rotinas convertem sem erro', rotinasEmUTC().length === 13)

    // Os cinco de hora fixa, um a um. Fixados de propósito: se alguém mudar o
    // deslocamento ou a tabela, é aqui que aparece — não em produção.
    const esperado: Record<string, string> = {
        'credits-reset': '13 6 * * *',
        retention: '41 7 * * *',
        'follow-up': '0 10 * * *',
        'billing-dunning': '27 8 * * *',
        'billing-reconcile': '47 8 * * *',
    }
    const emUtc = new Map(rotinasEmUTC().map((r) => [r.task as string, r.utc]))
    for (const [task, utc] of Object.entries(esperado)) {
        ok(`${task} dispara às ${utc} UTC`, emUtc.get(task) === utc, emUtc.get(task))
    }

    // As de hora curinga não podem mudar: "toda hora" é toda hora em qualquer fuso.
    const curingas = ROTINAS.filter((r) => r.brt.split(' ')[1].includes('*'))
    ok(
        'rotinas de hora curinga ficam intactas',
        curingas.every((r) => paraUTC(r.brt) === r.brt),
        `${curingas.length} rotinas`
    )

    // E o que a função NÃO sabe converter tem de recusar, não chutar.
    for (const [rotulo, padrao] of [
        ['intervalo de horas', '0 1-5 * * *'],
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
     * A guarda contra divergência.
     *
     * O `wrangler.jsonc` carrega os padrões em UTC, e eles são **gerados** por
     * `cronsParaWrangler()` a partir da intenção em BRT. Nada impede alguém de
     * editar o arquivo à mão — e a divergência resultante não daria erro: os
     * crons do arquivo é que valem, e a tabela do código passaria a ser ficção.
     *
     * Então o teste compara os dois. É o único jeito de a geração significar
     * algo depois do commit que a escreveu.
     */
    const wrangler = readFileSync('wrangler.jsonc', 'utf8')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/,(\s*[}\]])/g, '$1')
    const cronsNoArquivo: string[] = JSON.parse(wrangler).triggers.crons
    const cronsNoCodigo = cronsParaWrangler()

    ok(
        'o wrangler.jsonc tem os mesmos crons que a agenda gera',
        JSON.stringify([...cronsNoArquivo].sort()) === JSON.stringify([...cronsNoCodigo].sort()),
        `arquivo: ${cronsNoArquivo.length}, código: ${cronsNoCodigo.length}`
    )
    ok(
        'e nenhum deles ficou em horário de Brasília por engano',
        !cronsNoArquivo.includes('13 3 * * *') &&
            !cronsNoArquivo.includes('0 7 * * *') &&
            !cronsNoArquivo.includes('41 4 * * *') &&
            !cronsNoArquivo.includes('27 5 * * *') &&
            !cronsNoArquivo.includes('47 5 * * *')
    )
    ok('o despacho encontra a rotina pelo padrão', rotinasDoDisparo('0 10 * * *').includes('follow-up'))
    ok('padrão desconhecido não despacha nada', rotinasDoDisparo('59 23 * * *').length === 0)

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
    ok('publicou o pendente', res.publicados === 1, JSON.stringify(res))
    ok('o entregador recebeu o evento', entregues.length === 1 && entregues[0].workspaceId === ws.id)
    ok(
        'o payload carrega identificador, não conteúdo',
        JSON.stringify(entregues[0].payload).includes('conv-1') &&
            !JSON.stringify(entregues[0].payload).includes('Paciente')
    )

    const aindaPendente = await prisma.outboxEvent.count({ where: { workspaceId: ws.id, publishedAt: null } })
    ok('marcado como publicado depois da entrega', aindaPendente === 0)

    // Segunda passada não reentrega o que já saiu.
    let segunda = 0
    await publicarPendentes(async (ev) => {
        segunda = ev.length
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
        desistido = ev.length
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
