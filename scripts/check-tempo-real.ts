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

function main() {
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

    console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`)
    process.exit(falhas === 0 ? 0 : 1)
}

main()
