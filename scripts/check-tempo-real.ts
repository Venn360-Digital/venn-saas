/**
 * Prova as decisões do tempo real, isoladas da plataforma.
 *
 * Os Durable Objects **não rodam nesta máquina** — o `workerd` exige macOS 13.5+
 * e o Mac de desenvolvimento está em 12.7.6. Então toda decisão que pode errar
 * mora em função pura (`lib/realtime/`), onde tem teste, e o objeto fica sendo
 * uma casca que aplica o que a função devolveu.
 *
 * É o que torna este teste possível, e é por isso que ele cobre o que cobre: o
 * debounce da resposta do agente e a recuperação de reconexão são os dois
 * pedaços cujo erro é invisível — um faz o agente não responder, o outro deixa a
 * tela num estado que não corresponde ao banco.
 *
 * Não precisa de banco nem de rede:
 *
 *     npm run check:tempo-real
 */
import { decidir, TETO_DA_RAJADA_MS } from '@/lib/realtime/debounce'
import { assinar, verificar, BilheteInvalidoError, VALIDADE_SEGUNDOS } from '@/lib/realtime/bilhete'
import {
    interpretar,
    decidirRecuperacao,
    acrescentarAoHistorico,
    ehRepetido,
    MensagemInvalidaError,
    HISTORICO_DA_SALA,
    type EventoDaSala,
} from '@/lib/realtime/protocolo'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

const T0 = 1_700_000_000_000

async function main() {
    // ================================================================ debounce

    // Primeira mensagem: agenda, e a rajada começa agora.
    const d1 = decidir({
        agora: T0,
        alarmeAtual: null,
        inicioDaRajada: null,
        atrasoMs: 4_000,
        estado: 'ocioso',
    })
    ok('primeira mensagem agenda', d1.acao === 'agendar' && d1.para === T0 + 4_000)
    ok('e marca o início da rajada', d1.acao === 'agendar' && d1.inicioDaRajada === T0)

    // Segunda mensagem 2 s depois: empurra o disparo — é o ponto do debounce.
    const d2 = decidir({
        agora: T0 + 2_000,
        alarmeAtual: T0 + 4_000,
        inicioDaRajada: T0,
        atrasoMs: 4_000,
        estado: 'ocioso',
    })
    ok('mensagem nova empurra o disparo', d2.acao === 'agendar' && d2.para === T0 + 6_000)
    ok('e preserva o início da rajada', d2.acao === 'agendar' && d2.inicioDaRajada === T0)

    // Gerando: não mexe. Reagendar daria duas respostas à mesma pergunta.
    const d3 = decidir({
        agora: T0 + 5_000,
        alarmeAtual: null,
        inicioDaRajada: T0,
        atrasoMs: 4_000,
        estado: 'gerando',
    })
    ok('durante a geração não reagenda', d3.acao === 'nada' && d3.motivo === 'gerando')

    /**
     * O teto da rajada — o defeito que o BullMQ também tem.
     *
     * Sem teto, mensagens a cada 3 s com debounce de 4 s empurram a resposta
     * para sempre: ela nunca sai, e o sintoma é "o agente não respondeu", sem
     * erro em lugar nenhum.
     */
    const d4 = decidir({
        agora: T0 + TETO_DA_RAJADA_MS,
        alarmeAtual: T0 + TETO_DA_RAJADA_MS + 1_000,
        inicioDaRajada: T0,
        atrasoMs: 4_000,
        estado: 'ocioso',
    })
    ok('no teto da rajada, para de empurrar', d4.acao === 'nada' && d4.motivo === 'teto-da-rajada')

    // E a simulação que importa: trinta mensagens a cada 3 s não travam a resposta.
    let alarme: number | null = null
    let inicio: number | null = null
    let agendamentos = 0
    let travou = false
    for (let i = 0; i < 30; i++) {
        const agora = T0 + i * 3_000
        const d = decidir({ agora, alarmeAtual: alarme, inicioDaRajada: inicio, atrasoMs: 4_000, estado: 'ocioso' })
        if (d.acao === 'agendar') {
            alarme = d.para
            inicio = d.inicioDaRajada
            agendamentos++
        }
        // O alarme nunca pode ficar depois do teto contado do início.
        if (alarme !== null && inicio !== null && alarme > inicio + TETO_DA_RAJADA_MS) travou = true
    }
    ok('rajada de 30 mensagens não empurra o alarme além do teto', !travou)
    ok('o alarme para de ser reagendado', agendamentos < 30, `${agendamentos} de 30`)
    ok(
        'e o disparo cai no teto, não no infinito',
        alarme !== null && inicio !== null && alarme <= inicio + TETO_DA_RAJADA_MS,
        `alarme em +${alarme !== null && inicio !== null ? alarme - inicio : '?'}ms`
    )

    // Atraso maior que o teto não estoura o teto já na primeira mensagem.
    const d5 = decidir({
        agora: T0,
        alarmeAtual: null,
        inicioDaRajada: null,
        atrasoMs: TETO_DA_RAJADA_MS * 3,
        estado: 'ocioso',
    })
    ok(
        'atraso grande é limitado pelo teto',
        d5.acao === 'agendar' && d5.para === T0 + TETO_DA_RAJADA_MS
    )

    // ============================================================== protocolo

    ok('interpreta ola sem referência', interpretar('{"t":"ola"}').t === 'ola')
    const comRef = interpretar('{"t":"ola","ultimoVisto":"ev-9"}')
    ok('interpreta ola com referência', comRef.t === 'ola' && comRef.ultimoVisto === 'ev-9')
    ok('interpreta ping', interpretar('{"t":"ping"}').t === 'ping')

    // Entrada do navegador é entrada não confiável: tem de recusar, não ignorar.
    for (const [rotulo, cru] of [
        ['não é JSON', 'isto não é json'],
        ['não é objeto', '"texto"'],
        ['nulo', 'null'],
        ['tipo desconhecido', '{"t":"derrubar-o-servidor"}'],
        ['sem tipo', '{}'],
        ['ultimoVisto não é string', '{"t":"ola","ultimoVisto":42}'],
        ['ultimoVisto gigante', `{"t":"ola","ultimoVisto":"${'x'.repeat(200)}"}`],
    ] as const) {
        try {
            interpretar(cru)
            ok(`recusa mensagem inválida: ${rotulo}`, false, 'não lançou')
        } catch (e) {
            ok(`recusa mensagem inválida: ${rotulo}`, e instanceof MensagemInvalidaError)
        }
    }

    // ============================================================ recuperação

    const hist: EventoDaSala[] = [
        { id: 'ev-1', tipo: 'mensagem.nova', payload: {} },
        { id: 'ev-2', tipo: 'mensagem.nova', payload: {} },
        { id: 'ev-3', tipo: 'conversa.alterada', payload: {} },
    ]

    const prim = decidirRecuperacao(undefined, hist)
    ok('primeira conexão manda buscar por HTTP', prim.acao === 'sync' && prim.motivo === 'primeira-conexao')

    const rec = decidirRecuperacao('ev-1', hist)
    ok('reconexão reenvia só o que veio depois', rec.acao === 'reenviar' && rec.eventos.length === 2)
    ok(
        'e na ordem certa',
        rec.acao === 'reenviar' && rec.eventos[0].id === 'ev-2' && rec.eventos[1].id === 'ev-3'
    )

    const noFim = decidirRecuperacao('ev-3', hist)
    ok('quem está em dia não recebe nada', noFim.acao === 'reenviar' && noFim.eventos.length === 0)

    const velho = decidirRecuperacao('ev-de-ontem', hist)
    ok('lacuna grande manda buscar por HTTP', velho.acao === 'sync' && velho.motivo === 'lacuna-grande')

    // ============================================================== histórico

    let h: EventoDaSala[] = []
    for (let i = 0; i < HISTORICO_DA_SALA + 20; i++) {
        h = acrescentarAoHistorico(h, { id: `ev-${i}`, tipo: 'mensagem.nova', payload: {} })
    }
    ok('o histórico respeita o teto', h.length === HISTORICO_DA_SALA, `${h.length}`)
    ok('e guarda os mais recentes', h[h.length - 1].id === `ev-${HISTORICO_DA_SALA + 19}`)
    ok('descartando os mais antigos', !h.some((e) => e.id === 'ev-0'))

    ok('evento repetido é reconhecido', ehRepetido(hist, 'ev-2'))
    ok('evento novo não é repetido', !ehRepetido(hist, 'ev-99'))


    // ============================================================== bilhete

    /**
     * O bilhete é o que autoriza abrir o socket, e é o único ponto deste
     * caminho onde a falha é **silenciosa e grave**: aceitar um bilhete
     * adulterado entrega os eventos de um workspace a quem não participa dele.
     *
     * Verificável aqui porque é só WebCrypto — nada de plataforma.
     */
    const SEGREDO = 'segredo-de-teste-com-tamanho-razoavel'
    const T = 1_800_000_000_000

    const pega = async (fn: () => Promise<unknown>) => {
        try {
            await fn()
            return null
        } catch (erro) {
            return erro
        }
    }

    const bilhete = await assinar({ workspaceId: 'w1', usuarioId: 'u1' }, SEGREDO, T)
    const lidoDoBilhete = await verificar(bilhete, SEGREDO, T + 1_000)
    ok('bilhete: ida e volta', lidoDoBilhete.workspaceId === 'w1' && lidoDoBilhete.usuarioId === 'u1')

    /**
     * O corpo é **assinado, não cifrado** — e este teste prova justamente isso,
     * para que a propriedade fique registrada em vez de suposta.
     *
     * Escrevi antes que "nada vai em claro". Está errado: base64 é codificação,
     * e quem tem o bilhete lê o workspace decodificando. Tudo bem, porque quem
     * tem o bilhete é a pessoa autorizada, que já conhece o próprio workspace.
     * O que o HMAC garante é integridade. O que isto impede é alguém **pôr
     * segredo** aqui dentro confiando num sigilo que não existe.
     */
    const corpoLegivel = JSON.parse(
        Buffer.from(bilhete.split('.')[0]!, 'base64url').toString('utf8')
    ) as { w: string }
    ok(
        'bilhete: o corpo e legivel por quem o tem (assinado, nao cifrado)',
        corpoLegivel.w === 'w1',
        'por isso: nenhum segredo aqui dentro'
    )

    const outroSegredo = await pega(() => verificar(bilhete, SEGREDO + 'x', T + 1_000))
    ok(
        'bilhete: segredo errado recusa',
        outroSegredo instanceof BilheteInvalidoError && outroSegredo.motivo === 'assinatura'
    )

    // O ataque que importa: corpo de outro workspace com assinatura válida de
    // um bilhete legítimo. Sem verificar a assinatura ANTES de ler o corpo,
    // isto passaria.
    const doW2 = await assinar({ workspaceId: 'w2', usuarioId: 'u1' }, SEGREDO, T)
    const costurado = doW2.split('.')[0] + '.' + bilhete.split('.')[1]
    const adulterado = await pega(() => verificar(costurado, SEGREDO, T + 1_000))
    ok('bilhete: corpo de outro workspace com assinatura alheia recusa', adulterado instanceof BilheteInvalidoError)

    const vencido = await pega(() => verificar(bilhete, SEGREDO, T + VALIDADE_SEGUNDOS * 1_000 + 1))
    ok('bilhete: vencido recusa', vencido instanceof BilheteInvalidoError && vencido.motivo === 'vencido')

    const noLimite = await verificar(bilhete, SEGREDO, T + VALIDADE_SEGUNDOS * 1_000 - 1)
    ok('bilhete: valido ate o ultimo milissegundo', noLimite.workspaceId === 'w1')

    for (const ruim of ['', '.', 'semponto', 'corpo.', '.assinatura']) {
        const erro = await pega(() => verificar(ruim, SEGREDO, T))
        ok(`bilhete: formato "${ruim || '(vazio)'}" recusa`, erro instanceof BilheteInvalidoError)
    }


    // ================================================= contrato tela/emissores

    /**
     * As chaves que a tela lê têm de ser as chaves que os emissores escrevem.
     *
     * **Nada no compilador garante isso.** O payload é `Record<string, unknown>`
     * dos dois lados: escrever `conversaId` num emissor em vez de
     * `conversationId` grava o evento, entrega o evento, e a tela simplesmente
     * não reage. Sem erro em lugar nenhum, com tudo em volta funcionando — o
     * defeito mais caro de diagnosticar que este caminho admite.
     *
     * Por isso o contrato vive em `CHAVES` e este teste o confere nas duas
     * direções.
     */
    const fs = await import('node:fs')
    const tela = fs.readFileSync('src/app/(dashboard)/atendimento/conversas/page.tsx', 'utf8')
    const { CHAVES } = await import('@/lib/outbox/avisar')

    // Direção 1: tudo o que os emissores mandam é lido pela tela.
    for (const [tipo, chaves] of Object.entries(CHAVES)) {
        ok(`contrato: a tela trata "${tipo}"`, tela.includes(`tipo === '${tipo}'`))
        for (const chave of chaves) {
            // Com limite de palavra: `includes('payload.direction')` dá positivo
            // em `payload.directionX`, e foi o que esta linha fez na primeira
            // versão — um typo passou pela direção 1 e só a direção 2 o pegou.
            ok(
                `contrato: a tela lê payload.${chave} (de "${tipo}")`,
                new RegExp(`payload\\.${chave}\\b`).test(tela)
            )
        }
    }

    // Direção 2: tudo o que a tela lê é declarado por algum emissor. Pega o
    // typo no lado da tela, que a direção 1 não vê.
    const declaradas = new Set(Object.values(CHAVES).flat() as string[])
    // `digitando` é transmissão efêmera, não passa pelo outbox: as chaves dela
    // vêm de `trabalhos/tempo-real.ts`, não de `CHAVES`.
    for (const efemera of ['isTyping', 'source']) declaradas.add(efemera)

    const lidas = new Set(
        [...tela.matchAll(/payload\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!)
    )
    const orfas = [...lidas].filter((c) => !declaradas.has(c))
    ok(
        'contrato: a tela não lê chave que ninguém emite',
        orfas.length === 0,
        orfas.length ? orfas.join(', ') : `${lidas.size} chave(s) conferida(s)`
    )

    /**
     * A tela não pode ter voltado ao Supabase — mas o que se confere é **uso**,
     * não menção.
     *
     * A primeira versão deste teste reprovava qualquer aparição da palavra, e
     * reprovou os próprios comentários que explicam o que saiu dali e por quê.
     * Esse registro é desejável: é o que impede alguém de "consertar" o tempo
     * real voltando ao mecanismo antigo. O que não pode voltar é a chamada.
     */
    for (const uso of ['createClient(', 'supabase.channel', 'supabase.realtime', "'postgres_changes'"]) {
        ok(`contrato: a tela não usa "${uso}"`, !tela.includes(uso))
    }


    // ========================================== emissão + publicação imediata

    /**
     * Quem grava aviso tem de disparar a publicação imediata.
     *
     * A varredura da outbox pega o disparo `* * * * *`, e Cron Triggers têm
     * granularidade de um minuto. Um ponto de emissão sem `publicarAgora()`
     * não falha: o evento é gravado, entregue na varredura, e chega **até 60 s
     * depois** — perdendo do polling de 15 s que este caminho veio substituir.
     * O tempo real continuaria "funcionando", só devagar o bastante para não
     * servir, e ninguém veria erro.
     */
    const { execSync } = await import('node:child_process')
    const emissores = execSync(
        "grep -rl 'avisarMensagemNova\\|avisarStatusDaMensagem\\|avisarConversaAlterada' src --include=*.ts --include=*.tsx | grep -v 'outbox/avisar.ts' || true",
        { encoding: 'utf8' }
    )
        .split('\n')
        .filter(Boolean)

    ok('emissão: há pontos de emissão', emissores.length > 0, `${emissores.length} arquivo(s)`)

    for (const arquivo of emissores) {
        const conteudo = fs.readFileSync(arquivo, 'utf8')
        ok(
            `emissão: ${arquivo.split('/').slice(-2).join('/')} publica imediatamente`,
            conteudo.includes('publicarAgora()')
        )
    }

    console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`)
    process.exit(falhas === 0 ? 0 : 1)
}

void main()
