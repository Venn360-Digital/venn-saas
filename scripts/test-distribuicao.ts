/**
 * Quem recebe a próxima conversa, e para onde vai a entrega.
 *
 *   npm run test:distribuicao
 *
 * Dois casos de empresa forçaram o desenho, e os dois estão aqui porque nenhuma
 * regra única serve aos dois:
 *
 *   - **empresa que atende 8h–18h**: à noite estão todos ausentes. O lead da
 *     madrugada precisa ganhar dono assim mesmo, para quem chega às 8h ter
 *     carteira;
 *   - **empresa com turnos**: o lead das 2h não pode cair em quem trabalha de
 *     manhã e nunca vai olhar.
 *
 * O que separa os dois é `soDisponiveis`, e é por isso que ele existe.
 *
 * E há uma terceira coisa, que vale nos dois: no **handoff**, o status é lido
 * sempre. Carteira tolera dono ausente; entrega urgente não.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import {
    POLITICA_PADRAO,
    destinoDaEntrega,
    escolherDono,
    MINUTOS_PARA_DESCONECTADO,
    estaDisponivel,
    estadoVisivel,
    podeReceber,
    type MembroElegivel,
    type PoliticaDeDistribuicao,
} from '@venn/core/lib/conversas/distribuicao'

let passou = 0
let falhou = 0

function conferir(nome: string, real: unknown, esperado: unknown) {
    const a = JSON.stringify(real)
    const b = JSON.stringify(esperado)
    if (a === b) {
        passou++
        console.log(`  ok  ${nome}`)
    } else {
        falhou++
        console.log(`  XX  ${nome}\n        esperado: ${b}\n        veio:     ${a}`)
    }
}

/** Um membro, com o mínimo para a conta. */
function membro(p: Partial<MembroElegivel> & { userId: string }): MembroElegivel {
    return { status: 'disponivel', ultimaAtribuicao: null, abertas: 0, ...p }
}

const em = (iso: string) => new Date(iso)

const RODIZIO: PoliticaDeDistribuicao = { estrategia: 'rodizio', soDisponiveis: false }
const BALANCEADO: PoliticaDeDistribuicao = { estrategia: 'balanceado', soDisponiveis: false }
const SO_DISPONIVEIS: PoliticaDeDistribuicao = { estrategia: 'rodizio', soDisponiveis: true }

console.log('\nO padrão não distribui — conta nova não ganha comportamento novo sozinha')

conferir('a política padrão é "nenhuma"', POLITICA_PADRAO.estrategia, 'nenhuma')
conferir('e o interruptor nasce desligado', POLITICA_PADRAO.soDisponiveis, false)
conferir(
    'com "nenhuma", ninguém é escolhido mesmo havendo gente',
    escolherDono([membro({ userId: 'ana' })], POLITICA_PADRAO),
    null
)

console.log('\nRodízio — quem recebeu há mais tempo')

conferir(
    'entre três, ganha a atribuição mais antiga',
    escolherDono(
        [
            membro({ userId: 'ana', ultimaAtribuicao: em('2026-11-03T10:00:00Z') }),
            membro({ userId: 'bruno', ultimaAtribuicao: em('2026-11-03T08:00:00Z') }),
            membro({ userId: 'carla', ultimaAtribuicao: em('2026-11-03T09:00:00Z') }),
        ],
        RODIZIO
    ),
    'bruno'
)

/**
 * Quem nunca recebeu vem antes de todo mundo. Sem isto, quem entra na equipe
 * hoje só receberia depois de os outros darem uma volta inteira.
 */
conferir(
    'quem nunca recebeu passa à frente de quem recebeu ontem',
    escolherDono(
        [
            membro({ userId: 'ana', ultimaAtribuicao: em('2026-11-02T08:00:00Z') }),
            membro({ userId: 'novato', ultimaAtribuicao: null }),
        ],
        RODIZIO
    ),
    'novato'
)

/**
 * Determinismo: dois que nunca receberam têm de dar sempre a mesma resposta,
 * ou o teste não prova nada e a distribuição vira sorteio sem querer.
 */
conferir(
    'empate é resolvido pelo userId, e não pela ordem da lista',
    [
        escolherDono([membro({ userId: 'bruno' }), membro({ userId: 'ana' })], RODIZIO),
        escolherDono([membro({ userId: 'ana' }), membro({ userId: 'bruno' })], RODIZIO),
    ],
    ['ana', 'ana']
)

console.log('\nBalanceado — menos conversas abertas')

conferir(
    'ganha quem tem menos abertas, mesmo tendo recebido agora há pouco',
    escolherDono(
        [
            membro({ userId: 'ana', abertas: 1, ultimaAtribuicao: em('2026-11-03T11:00:00Z') }),
            membro({ userId: 'bruno', abertas: 7, ultimaAtribuicao: em('2026-11-01T08:00:00Z') }),
        ],
        BALANCEADO
    ),
    'ana'
)

/**
 * Equipe parada, todo mundo com zero aberta: sem desempate por rodízio, o
 * "balanceado" entregaria tudo ao primeiro da lista até ele passar à frente.
 */
conferir(
    'carga igual cai no rodízio, e não no primeiro da lista',
    escolherDono(
        [
            membro({ userId: 'ana', abertas: 0, ultimaAtribuicao: em('2026-11-03T10:00:00Z') }),
            membro({ userId: 'bruno', abertas: 0, ultimaAtribuicao: em('2026-11-03T07:00:00Z') }),
        ],
        BALANCEADO
    ),
    'bruno'
)

console.log('\nO interruptor — os dois formatos de empresa')

const noturno = [
    membro({ userId: 'ana', status: 'ausente', ultimaAtribuicao: em('2026-11-03T17:00:00Z') }),
    membro({ userId: 'bruno', status: 'ausente', ultimaAtribuicao: em('2026-11-03T16:00:00Z') }),
]

conferir(
    'empresa 8h-18h: às 2h da manhã o lead ganha dono assim mesmo',
    escolherDono(noturno, RODIZIO),
    'bruno'
)
conferir(
    'empresa com turnos: às 2h da manhã ninguém recebe',
    escolherDono(noturno, SO_DISPONIVEIS),
    null
)

conferir(
    'com o interruptor ligado, o ausente é pulado e o disponível recebe',
    escolherDono(
        [
            membro({ userId: 'ana', status: 'ausente', ultimaAtribuicao: em('2026-11-01T08:00:00Z') }),
            membro({ userId: 'bruno', status: 'disponivel', ultimaAtribuicao: em('2026-11-03T08:00:00Z') }),
        ],
        SO_DISPONIVEIS
    ),
    'bruno'
)

/**
 * Ocupado e ausente são **iguais** para a distribuição. A diferença é para a
 * equipe saber se vale chamar no particular — e a tela precisa dizer isso,
 * senão alguém supõe que amarelo recebe menos, e recebe nada.
 */
conferir(
    'ocupado não recebe, igual ao ausente',
    [
        podeReceber(membro({ userId: 'x', status: 'ocupado' }), SO_DISPONIVEIS),
        podeReceber(membro({ userId: 'x', status: 'ausente' }), SO_DISPONIVEIS),
        podeReceber(membro({ userId: 'x', status: 'disponivel' }), SO_DISPONIVEIS),
    ],
    [false, false, true]
)
conferir(
    'e com o interruptor desligado o status é ignorado — os três recebem',
    [
        podeReceber(membro({ userId: 'x', status: 'ocupado' }), RODIZIO),
        podeReceber(membro({ userId: 'x', status: 'ausente' }), RODIZIO),
        podeReceber(membro({ userId: 'x', status: 'disponivel' }), RODIZIO),
    ],
    [true, true, true]
)

console.log('\nSem ninguém — e por que null não é erro')

conferir('lista vazia devolve null', escolherDono([], RODIZIO), null)
conferir(
    'equipe toda ausente com o interruptor ligado devolve null',
    escolherDono([membro({ userId: 'ana', status: 'ausente' })], SO_DISPONIVEIS),
    null
)

console.log('\nA entrega no handoff — o status vale SEMPRE aqui')

/**
 * O caso concreto: paciente com dor às 19h, dono designado às 14h já em casa.
 * A entrega não pode ficar parada com ele.
 */
conferir(
    'dono ausente não recebe a entrega — vai para a fila geral',
    destinoDaEntrega(membro({ userId: 'ana', status: 'ausente' })),
    null
)
conferir(
    'dono ocupado também não',
    destinoDaEntrega(membro({ userId: 'ana', status: 'ocupado' })),
    null
)
conferir(
    'dono disponível recebe',
    destinoDaEntrega(membro({ userId: 'ana', status: 'disponivel' })),
    'ana'
)
conferir('sem dono, fila geral', destinoDaEntrega(null), null)

/**
 * A assimetria que o desenho quis: a **carteira** de uma empresa sem turno
 * ignora o status, mas a **entrega** dela não. São perguntas diferentes — quem
 * responde por isto, e quem atende agora.
 */
conferir(
    'empresa sem turno: distribui para o ausente, mas não entrega a ele',
    [
        escolherDono([membro({ userId: 'ana', status: 'ausente' })], RODIZIO),
        destinoDaEntrega(membro({ userId: 'ana', status: 'ausente' })),
    ],
    ['ana', null]
)

console.log('\nA escada do Teams — 1h amarelo, 8h cinza')

const AGORA_ESCADA = em('2026-11-04T18:00:00Z')
const parado = (horas: number) => new Date(AGORA_ESCADA.getTime() - horas * 3_600_000)
const UMA_HORA = 60

conferir(
    'verde mexendo agora continua verde',
    estadoVisivel('disponivel', parado(0.1), UMA_HORA, AGORA_ESCADA),
    'disponivel'
)
conferir(
    'verde parado 2 horas vira ausente (amarelo)',
    estadoVisivel('disponivel', parado(2), UMA_HORA, AGORA_ESCADA),
    'ausente'
)
conferir(
    'verde parado 9 horas vira desconectado (cinza)',
    estadoVisivel('disponivel', parado(9), UMA_HORA, AGORA_ESCADA),
    'desconectado'
)
conferir('a segunda régua é fixa em 8 horas', MINUTOS_PARA_DESCONECTADO, 480)

/**
 * **A escolha manual é pegajosa, e esta é a armadilha que o desenho evita.**
 *
 * Se qualquer atividade devolvesse ao verde, quem se marca "ocupado" para uma
 * reunião e abre o sistema para conferir um horário voltaria a verde no clique
 * — e receberia lead no meio da reunião. A escada só mexe em quem está verde.
 */
conferir(
    'ocupado continua ocupado mesmo mexendo no sistema agora',
    estadoVisivel('ocupado', parado(0), UMA_HORA, AGORA_ESCADA),
    'ocupado'
)
conferir(
    'ausente escolhido à mão não vira desconectado pela escada',
    estadoVisivel('ausente', parado(9), UMA_HORA, AGORA_ESCADA),
    'ausente'
)

/**
 * A escada nunca produz `ocupado`: vermelho é escolha, e dizer "ocupado" de
 * quem foi embora informaria à equipe que a pessoa está presente.
 */
conferir(
    'a escada nunca produz ocupado',
    [0.1, 2, 9, 20].map((h) => estadoVisivel('disponivel', parado(h), UMA_HORA, AGORA_ESCADA)),
    ['disponivel', 'ausente', 'desconectado', 'desconectado']
)

conferir(
    'verde que nunca agiu é desconectado, não disponível',
    estadoVisivel('disponivel', null, UMA_HORA, AGORA_ESCADA),
    'desconectado'
)
conferir(
    'com a escada desligada (0), verde é verde para sempre',
    estadoVisivel('disponivel', parado(20), 0, AGORA_ESCADA),
    'disponivel'
)

/** Só verde recebe — e `desconectado` entra na conta como os outros dois. */
conferir(
    'só o verde recebe, nos quatro estados',
    (['disponivel', 'ocupado', 'ausente', 'desconectado'] as const).map((e) =>
        podeReceber(membro({ userId: 'x', status: e, ultimaAtividadeEm: parado(0) }), SO_DISPONIVEIS, UMA_HORA, AGORA_ESCADA)
    ),
    [true, false, false, false]
)

console.log('\nA queda automática — quem foi embora verde')

/**
 * O problema que isto resolve: status manual só funciona se as pessoas
 * lembrarem. Às 18h todo mundo vai embora marcado como disponível, e a
 * distribuição da madrugada cairia em quem não está — exatamente o que o
 * interruptor existe para evitar.
 *
 * A saída é **derivar** a disponibilidade da atividade, e não gravar o flip por
 * um job: mesmo resultado, sem cron, sem escrita, sem estado a mais para
 * divergir — e, por ser conta pura, provável aqui.
 */
const AGORA = em('2026-11-04T02:00:00Z')

conferir(
    'marcado disponível mas sem agir há 3 horas: não está disponível',
    estaDisponivel(
        membro({ userId: 'ana', ultimaAtividadeEm: em('2026-11-03T23:00:00Z') }),
        30,
        AGORA
    ),
    false
)
conferir(
    'marcado disponível e agiu há 5 minutos: está',
    estaDisponivel(
        membro({ userId: 'ana', ultimaAtividadeEm: em('2026-11-04T01:55:00Z') }),
        30,
        AGORA
    ),
    true
)

/**
 * "Status antigo" não é sinal de ausência — quem trabalha há duas horas tem o
 * status antigo e está presente. O que diz presença é atividade, e é por isso
 * que a conta olha `ultimaAtividadeEm` e não `statusEm`.
 */
conferir(
    'quem trabalha há horas sem parar continua disponível',
    estaDisponivel(
        membro({ userId: 'ana', ultimaAtividadeEm: em('2026-11-04T01:59:00Z') }),
        30,
        AGORA
    ),
    true
)

conferir(
    'nunca agiu não está disponível, mesmo marcado como tal',
    estaDisponivel(membro({ userId: 'novato', ultimaAtividadeEm: null }), 30, AGORA),
    false
)
conferir(
    'com a queda desligada (0), vale só o que foi marcado',
    [
        estaDisponivel(membro({ userId: 'ana', ultimaAtividadeEm: null }), 0, AGORA),
        estaDisponivel(membro({ userId: 'b', status: 'ausente', ultimaAtividadeEm: null }), 0, AGORA),
    ],
    [true, false]
)

conferir(
    'na distribuição: quem foi embora verde não recebe a conversa da madrugada',
    escolherDono(
        [
            membro({ userId: 'saiu', ultimaAtividadeEm: em('2026-11-03T18:00:00Z') }),
            membro({ userId: 'plantao', ultimaAtividadeEm: em('2026-11-04T01:58:00Z') }),
        ],
        SO_DISPONIVEIS,
        30,
        AGORA
    ),
    'plantao'
)

conferir(
    'e na entrega: dono que sumiu há 3 horas manda para a fila geral',
    destinoDaEntrega(
        membro({ userId: 'ana', ultimaAtividadeEm: em('2026-11-03T23:00:00Z') }),
        30,
        AGORA
    ),
    null
)

console.log('\n— a paciência por pessoa ganha da conta —\n')

{
    const agora = new Date('2026-11-06T12:00:00Z')
    const paradoHa = (min: number) => new Date(agora.getTime() - min * 60_000)

    // Padrão da conta: 60 min. Parado há 90 → ausente.
    conferir(
        'sem valor próprio, segue o padrão do sistema',
        estaDisponivel(
            { userId: 'a', status: 'disponivel', ultimaAtribuicao: null, abertas: 0, ultimaAtividadeEm: paradoHa(90) },
            60,
            agora
        ),
        false
    )

    // A mesma pessoa, com 120 min de paciência própria → ainda disponível.
    conferir(
        'o valor da pessoa estende a paciência',
        estaDisponivel(
            { userId: 'a', status: 'disponivel', ultimaAtribuicao: null, abertas: 0, ultimaAtividadeEm: paradoHa(90), minutosParaAusente: 120 },
            60,
            agora
        ),
        true
    )

    // E encurta, na outra direção.
    conferir(
        'o valor da pessoa também encurta',
        estaDisponivel(
            { userId: 'a', status: 'disponivel', ultimaAtribuicao: null, abertas: 0, ultimaAtividadeEm: paradoHa(30), minutosParaAusente: 10 },
            60,
            agora
        ),
        false
    )

    /**
     * A afirmação que o `??` existe para sustentar.
     *
     * Zero desliga a queda automática para aquela pessoa — o caso de quem
     * trabalha fora da tela. Com `||` em vez de `??`, zero cairia no padrão da
     * conta e a exceção seria impossível de expressar.
     */
    conferir(
        'zero na pessoa DESLIGA a queda, não cai no padrão',
        estaDisponivel(
            { userId: 'a', status: 'disponivel', ultimaAtribuicao: null, abertas: 0, ultimaAtividadeEm: paradoHa(600), minutosParaAusente: 0 },
            60,
            agora
        ),
        true
    )

    // E o que a pessoa marcou continua valendo acima de tudo: ocupado não recebe.
    conferir(
        'paciência própria não ressuscita quem se marcou ocupado',
        estaDisponivel(
            { userId: 'a', status: 'ocupado', ultimaAtribuicao: null, abertas: 0, ultimaAtividadeEm: paradoHa(1), minutosParaAusente: 999 },
            60,
            agora
        ),
        false
    )
}

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
