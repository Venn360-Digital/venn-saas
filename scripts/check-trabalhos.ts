/**
 * Prova as costuras entre o trabalho de fila e a plataforma.
 *
 * O trabalho em si (`src/trabalhos/processadores/`) é o mesmo código que o
 * processo `workers/` rodava — lógica de negócio que já estava exercitada em
 * produção. O que é **novo** nesta migração são as cinco costuras que o ligam à
 * Cloudflare, e é nelas que um erro é invisível:
 *
 *   - `filas`      quem enfileira lança quando não há driver, nunca descarta
 *   - `agenda`     agendar lança; concluir **não** lança
 *   - `trava`      exclusão mútua, com conferência de dono
 *   - `tempo-real` transmitir nunca derruba o processamento
 *   - `ambiente`   valida tarde e lança, em vez de matar o isolate
 *
 * E uma invariante de ligação: as oito filas têm processador. Uma fila sem
 * processador não falha o build — ela repete a mensagem até a DLQ, em silêncio.
 *
 * Não precisa de banco, de rede nem de Cloudflare:
 *
 *     npm run check:trabalhos
 */
import { ALL_QUEUES, QUEUE, TENTATIVAS, DEFAULT_JOB_OPTIONS } from '@/lib/queue/definitions'
import { consumirLote, type MensagemDaFila } from '@/lib/queue/consumidor'
import { registrarDriver, driverAtual, type DriverDeFila } from '@/lib/queue/driver'
import { enfileirar, SemDriverDeFilaError } from '@/trabalhos/filas'
import { agendarResposta, concluirResposta, registrarAgenda, SemAgendaError } from '@/trabalhos/agenda'
import { withLock, registrarTravas, LockTimeoutError, type Travas } from '@/trabalhos/trava'
import { transmitir, registrarTransmissor } from '@/trabalhos/tempo-real'
import { ambiente, esquecerAmbiente, AmbienteInvalidoError } from '@/trabalhos/ambiente'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

async function lanca(fn: () => Promise<unknown>): Promise<unknown> {
    try {
        await fn()
        return null
    } catch (erro) {
        return erro
    }
}

async function main() {
    // ============================================================== ligação

    // A razão de existir deste teste. `PROCESSADORES` admite `null` para que
    // uma fila nova possa entrar declarada e pendente — e é justamente por
    // isso que esquecer de ligar uma não quebra nada visível: a mensagem é
    // repetida até a DLQ, sem erro de build e sem erro de tipo.
    // Lido como **texto**, não importado: `entrada.ts` importa
    // `vinext/server/fetch-handler`, que é módulo virtual resolvido só pelo
    // plugin do Vite — o Node não tem como carregá-lo. E para esta verificação
    // o texto basta: o que se quer saber é se alguém deixou um `null` no mapa.
    const fonte = await import('node:fs').then((fs) =>
        fs.readFileSync('src/cloudflare/entrada.ts', 'utf8')
    )
    const cfg = await import('node:fs').then((fs) => fs.readFileSync('cloudflare.config.ts', 'utf8'))
    const mapa = fonte.slice(fonte.indexOf('const PROCESSADORES'), fonte.indexOf('IDS_DE_DEDUP'))

    // Do valor da fila para a chave da constante: o mapa é escrito
    // `[QUEUE.WHATSAPP_INBOUND]`, não `['whatsapp-inbound']`. Procurar pelo
    // valor acha "whatsapp-inbound" mas não "cron", porque a chave é `CRON` —
    // foi exatamente o falso negativo que a primeira versão deste teste deu.
    const chaveDa = new Map(Object.entries(QUEUE).map(([chave, valor]) => [valor as string, chave]))

    for (const fila of ALL_QUEUES) {
        const chave = chaveDa.get(fila)
        const linha = mapa.split('\n').find((l) => l.includes(`[QUEUE.${chave}]`))
        const ligada = Boolean(linha) && !/:\s*null/.test(linha!)
        ok(`ligação: a fila "${fila}" tem processador`, ligada, linha?.trim().slice(0, 60))
    }

    // A dedup do outbound é o que impede mandar a mesma mensagem duas vezes ao
    // paciente. Era `jobId` no BullMQ; se não estiver aqui, sai calada.
    ok(
        'ligação: whatsapp-outbound deduplica por messageId',
        /WHATSAPP_OUTBOUND\]:\s*\(p\)\s*=>\s*p\.messageId/.test(fonte),
        'IDS_DE_DEDUP'
    )

    // ====================================================== declaração dos DO

    /**
     * Todo Durable Object que as costuras usam tem de estar **declarado** na
     * config, com `exports` e `bindings`.
     *
     * Isto existe porque o typecheck não pega: `EnvDasCosturas` é uma interface,
     * então o código compila com o binding ausente e falha só em execução — e
     * falha fundo, no meio do processamento de uma mensagem de paciente.
     * Aconteceu agora: `TravaDeContato` foi escrita, exportada em `entrada.ts`
     * e **esquecida** na config.
     */
    for (const classe of ['SalaDoWorkspace', 'AgendaDaConversa', 'TravaDeContato']) {
        ok(
            `durable object: "${classe}" exportada em entrada.ts`,
            new RegExp(`export \\{ ${classe} \\}`).test(fonte)
        )
        ok(
            `durable object: "${classe}" declarada em exports da config`,
            new RegExp(`${classe}: exports\\.durableObject`).test(cfg)
        )
        ok(
            `durable object: "${classe}" tem binding na config`,
            new RegExp(`exportName: '${classe}'`).test(cfg)
        )
    }

    // ================================================================ cron

    /**
     * Toda rotina do relógio tem de existir no despacho, e vice-versa.
     *
     * O caminho é longo — gatilho em UTC → `rotinasDoDisparo` → fila `cron` →
     * `TASKS[task]` — e um nome escrito de dois jeitos não falha em lugar
     * nenhum: `processCron` registra "unknown cron task" e **retorna**, a
     * mensagem é confirmada, e a rotina simplesmente nunca roda. Já aconteceu
     * neste projeto com `evolution_go` contra `evolution-go`.
     */
    const despacho = await import('node:fs').then((fs) =>
        fs.readFileSync('src/trabalhos/processadores/cron/index.ts', 'utf8')
    )
    const blocoTasks = despacho.slice(despacho.indexOf('const TASKS'), despacho.indexOf('export async function'))
    const noDespacho = new Set([...blocoTasks.matchAll(/^\s*'?([a-z-]+)'?:/gm)].map((m) => m[1]!))
    const { ROTINAS } = await import('@/lib/cron/agenda')
    const naAgenda = ROTINAS.map((r) => r.task)

    /**
     * **Tarefas distintas**, não entradas — e a diferença custou uma reprovação.
     *
     * A asserção era `length === 13` sobre as entradas de `ROTINAS`. Em
     * 2026-10-24 a verificação de integração ganhou uma segunda entrada (uma
     * janela de dia, outra de noite), e a contagem virou 14. O número estava
     * certo; a pergunta é que estava errada — o que importa aqui é que **todas
     * as tarefas despachadas tenham agenda e vice-versa**, não quantas linhas
     * a tabela tem.
     *
     * Ficou invisível por horas porque este verificador **não estava em
     * workflow nenhum**. Agora está.
     */
    const tarefas = [...new Set(naAgenda)]
    ok('cron: as 13 tarefas estão na agenda', tarefas.length === 13, `${tarefas.length} tarefas em ${naAgenda.length} entradas`)
    for (const task of naAgenda) {
        ok(`cron: "${task}" tem despacho`, noDespacho.has(task))
    }
    const orfas = [...noDespacho].filter((t) => !naAgenda.includes(t as never))
    ok('cron: nenhuma tarefa despachada sem agenda', orfas.length === 0, orfas.join(', '))

    // =========================================================== TENTATIVAS

    for (const fila of ALL_QUEUES) {
        ok(
            `tentativas: "${fila}" derivado de DEFAULT_JOB_OPTIONS`,
            TENTATIVAS[fila] === (DEFAULT_JOB_OPTIONS[fila].attempts ?? 1),
            `${TENTATIVAS[fila]}`
        )
    }

    // A config da Cloudflare tem de **derivar**, não repetir: dois números
    // escritos à parte se separam calados, e aí o consumidor acha que ainda há
    // tentativa quando a plataforma já mandou para a DLQ.
    ok(
        'tentativas: cloudflare.config.ts deriva maxRetries de TENTATIVAS',
        /maxRetries:\s*TENTATIVAS\[fila\]\s*-\s*1/.test(cfg)
    )
    ok(
        'tentativas: nenhum maxRetries literal sobrou na config',
        !/maxRetries:\s*\d/.test(cfg)
    )

    // ================================================================ filas

    const enviados: Array<{ fila: string; payload: unknown; atraso?: number }> = []
    ok('filas: nenhum driver registrado no início', driverAtual() === null)

    const erroSemDriver = await lanca(() =>
        enfileirar(QUEUE.RAG_INDEX, { documentId: 'd1', workspaceId: 'w1' } as never)
    )
    ok(
        'filas: enfileirar sem driver LANÇA (nunca descarta)',
        erroSemDriver instanceof SemDriverDeFilaError,
        (erroSemDriver as Error)?.name
    )

    const driverFalso: DriverDeFila = {
        nome: 'cloudflare',
        async enviar(fila, payload, opcoes) {
            enviados.push({ fila, payload, atraso: opcoes?.atrasoSegundos })
        },
    }
    registrarDriver(driverFalso)

    await enfileirar(QUEUE.WHATSAPP_OUTBOUND, { messageId: 'm1', to: '55', kind: 'text', content: 'oi' } as never)
    ok('filas: envia para a fila certa', enviados[0]?.fila === QUEUE.WHATSAPP_OUTBOUND, enviados[0]?.fila)
    ok(
        'filas: o payload atravessa intacto',
        (enviados[0]?.payload as { messageId?: string })?.messageId === 'm1'
    )

    await enfileirar(QUEUE.WHATSAPP_EVENT, { provider: 'evolution-go' } as never, { atrasoSegundos: 20 })
    ok('filas: o atraso atravessa em segundos', enviados[1]?.atraso === 20, String(enviados[1]?.atraso))

    // =============================================================== agenda

    const erroSemAgenda = await lanca(() =>
        agendarResposta('c1', { conversationId: 'c1' } as never, 4000)
    )
    ok(
        'agenda: agendar sem agenda LANÇA (é o caminho da resposta)',
        erroSemAgenda instanceof SemAgendaError
    )

    // Assimetria deliberada: concluir é chamado do `finally` do gerador, e um
    // erro aqui mascararia o erro real da geração.
    const erroConcluir = await lanca(() => concluirResposta('c1'))
    ok('agenda: concluir sem agenda NÃO lança', erroConcluir === null)

    const agendados: Array<{ id: string; atraso: number }> = []
    const concluidos: string[] = []
    registrarAgenda({
        async agendar(id, _p, atrasoMs) {
            agendados.push({ id, atraso: atrasoMs })
        },
        async concluir(id) {
            concluidos.push(id)
        },
    })

    await agendarResposta('c2', { conversationId: 'c2' } as never, 7000)
    ok('agenda: agendar chega ao objeto da conversa', agendados[0]?.id === 'c2' && agendados[0]?.atraso === 7000)

    await concluirResposta('c2')
    ok('agenda: concluir chega ao objeto da conversa', concluidos[0] === 'c2')

    // E mesmo com a agenda registrada, concluir que falha não propaga: senão o
    // `finally` do gerador trocaria o erro real por este.
    registrarAgenda({
        async agendar() {},
        async concluir() {
            throw new Error('objeto indisponível')
        },
    })
    const erroConcluirQuebrado = await lanca(() => concluirResposta('c3'))
    ok('agenda: concluir que falha NÃO propaga', erroConcluirQuebrado === null)

    // ================================================================ trava

    // Sem travas registradas, roda sem exclusão mútua em vez de não atender
    // ninguém — degradação declarada, e registrada em `error`.
    let correu = false
    await withLock('k1', async () => {
        correu = true
    })
    ok('trava: sem travas registradas, a seção crítica roda', correu)

    const estado = new Map<string, { token: string; expiraEm: number }>()
    const travasFalsas: Travas = {
        async adquirir(chave, token, ttlMs) {
            const dono = estado.get(chave)
            if (dono && dono.expiraEm > Date.now() && dono.token !== token) return false
            estado.set(chave, { token, expiraEm: Date.now() + ttlMs })
            return true
        },
        async liberar(chave, token) {
            if (estado.get(chave)?.token === token) estado.delete(chave)
        },
    }
    registrarTravas(travasFalsas)

    const ordem: string[] = []
    await withLock('contato:1', async () => {
        ordem.push('dentro')
    })
    ok('trava: adquire, roda e libera', ordem[0] === 'dentro' && !estado.has('contato:1'))

    // O `finally`: exceção na seção crítica não pode deixar a trava presa — se
    // deixasse, aquele contato ficaria travado até o TTL vencer, e toda mensagem
    // dele esperaria por nada.
    const erroDentro = await lanca(() =>
        withLock('contato:2', async () => {
            throw new Error('falhou dentro')
        })
    )
    ok('trava: exceção dentro ainda libera', (erroDentro as Error)?.message === 'falhou dentro')
    ok('trava: nada preso depois da exceção', !estado.has('contato:2'))

    // Ocupada: desiste depois do `waitMs` e lança — e lançar é o certo, porque a
    // mensagem volta para retentativa em vez de entrar sem exclusão.
    estado.set('contato:3', { token: 'outro', expiraEm: Date.now() + 60_000 })
    const erroOcupada = await lanca(() =>
        withLock('contato:3', async () => undefined, { waitMs: 150, retryDelayMs: 30 })
    )
    ok('trava: chave ocupada lança LockTimeoutError', erroOcupada instanceof LockTimeoutError)

    // Dono vencido: a trava é tomada. É o TTL existindo para o isolate que
    // morreu no meio da seção crítica.
    estado.set('contato:4', { token: 'morto', expiraEm: Date.now() - 1 })
    let tomou = false
    await withLock('contato:4', async () => {
        tomou = true
    })
    ok('trava: dono vencido é substituído', tomou)

    // Liberar com token alheio não derruba a trava de quem a tem agora.
    estado.set('contato:5', { token: 'vivo', expiraEm: Date.now() + 60_000 })
    await travasFalsas.liberar('contato:5', 'intruso')
    ok('trava: só o dono libera', estado.get('contato:5')?.token === 'vivo')

    // ============================================================ tempo real

    const erroSemTransmissor = await lanca(() =>
        transmitir({ workspaceId: 'w1', tipo: 'digitando', dados: {} })
    )
    ok('tempo real: transmitir sem transmissor NÃO lança', erroSemTransmissor === null)

    const transmitidos: Array<{ tipo: string; paraUsuario?: string }> = []
    registrarTransmissor(async (t) => {
        transmitidos.push({ tipo: t.tipo, paraUsuario: t.paraUsuario })
    })
    await transmitir({ workspaceId: 'w1', tipo: 'lembrete', dados: { atividadeIds: ['a1'] }, paraUsuario: 'u1' })
    ok(
        'tempo real: o endereçamento por pessoa atravessa',
        transmitidos[0]?.tipo === 'lembrete' && transmitidos[0]?.paraUsuario === 'u1'
    )

    // Transmissor que falha não derruba o processamento da mensagem: enfeite de
    // tela não pode custar o atendimento.
    registrarTransmissor(async () => {
        throw new Error('sala indisponível')
    })
    const erroTransmissorQuebrado = await lanca(() =>
        transmitir({ workspaceId: 'w1', tipo: 'digitando', dados: {} })
    )
    ok('tempo real: transmissor que falha NÃO propaga', erroTransmissorQuebrado === null)

    // ============================================ contexto da última entrega

    // É o que decide se o `whatsapp-outbound` marca a mensagem como falha. Cedo
    // demais: mensagem que ainda vai sair aparece como falha. Nunca: mensagem
    // morta na DLQ fica "enviando" para sempre na tela do atendente.
    const vistos: Array<{ tentativa: number; ultima: boolean }> = []
    const mensagemFalsa = (tentativas: number): MensagemDaFila<never> => ({
        body: {} as never,
        attempts: tentativas,
        ack() {},
        retry() {},
    })

    const total = TENTATIVAS[QUEUE.WHATSAPP_OUTBOUND]
    await consumirLote(
        { messages: [mensagemFalsa(1), mensagemFalsa(total - 1), mensagemFalsa(total)] },
        {
            fila: QUEUE.WHATSAPP_OUTBOUND,
            async processar(_p, ctx) {
                vistos.push({ tentativa: ctx.tentativa, ultima: ctx.ultimaTentativa })
            },
        }
    )
    ok('contexto: a primeira tentativa não é a última', vistos[0]?.ultima === false, `tentativa ${vistos[0]?.tentativa}`)
    ok('contexto: a penúltima não é a última', vistos[1]?.ultima === false, `tentativa ${vistos[1]?.tentativa}`)
    ok(`contexto: a ${total}ª é a última`, vistos[2]?.ultima === true, `tentativa ${vistos[2]?.tentativa}`)

    // ============================================================= ambiente

    // Valida tarde e lança. O módulo antigo chamava `process.exit(1)` — que num
    // Worker não derruba o isolate: a execução seguia e `env` era `undefined`,
    // então todo acesso virava TypeError longe da causa. E levaria o site, não
    // só a fila.
    esquecerAmbiente()
    const guardado = process.env.AI_HISTORY_LIMIT
    process.env.AI_HISTORY_LIMIT = 'não é número'
    const erroAmbiente = await lanca(async () => ambiente())
    ok('ambiente: valor inválido LANÇA (não encerra o processo)', erroAmbiente instanceof AmbienteInvalidoError)

    // `process.env.X = undefined` grava a **string** "undefined", que o zod
    // recusa igual — restaurar exige apagar a chave.
    if (guardado === undefined) delete process.env.AI_HISTORY_LIMIT
    else process.env.AI_HISTORY_LIMIT = guardado
    esquecerAmbiente()
    const lido = ambiente()
    ok('ambiente: os padrões valem sem nada configurado', lido.AGENT_SPEECH_MAX_CHARS === 900, String(lido.AGENT_SPEECH_MAX_CHARS))
    ok('ambiente: coerção numérica funciona', typeof lido.AI_RAG_CHUNKS === 'number')

    console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} TESTE(S) FALHARAM`)
    process.exit(falhas === 0 ? 0 : 1)
}

void main()
