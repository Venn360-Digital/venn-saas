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
    ESTRATEGIAS,
    POLITICA_PADRAO,
    destinoDaEntrega,
    escolherDono,
    lerPolitica,
    lerPoliticaDoCanal,
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

// ─────────────────────────── O atendente fixo ────────────────────────────────
//
// O pedido do Andre (26/11/2026): um número de WhatsApp sem rodízio, entregue
// direto a um atendente, ao lado de outro número que roda a fila. O que estes
// casos protegem é a fronteira — `fixo` que não resolve vai para a FILA GERAL,
// nunca para o rodízio. Virar fila em silêncio entregaria o paciente a quem a
// clínica não escolheu.
{
    console.log('\nAtendente fixo — a linha que não roda fila')

    const FIXO = (quem: string | null): PoliticaDeDistribuicao => ({
        estrategia: 'fixo',
        soDisponiveis: false,
        donoFixoUserId: quem,
    })

    // Bia esperou mais que a Ana: pelo rodízio seria dela. O fixo ignora a ordem.
    const equipe = [
        membro({ userId: 'ana', ultimaAtribuicao: em('2026-11-26T12:00:00Z') }),
        membro({ userId: 'bia', ultimaAtribuicao: em('2026-11-20T08:00:00Z') }),
    ]

    conferir('o rodízio daria a quem esperou mais', escolherDono(equipe, RODIZIO), 'bia')
    conferir('o fixo dá a quem foi nomeado, não a quem esperou', escolherDono(equipe, FIXO('ana')), 'ana')

    /**
     * As três quedas, e todas na fila geral.
     *
     * Política pela metade (sem pessoa), pessoa que saiu da clínica, e pessoa
     * fora com o interruptor ligado. Em nenhuma delas o resultado pode ser
     * **outra** pessoa: é o que diferencia "cai na fila" de "vira rodízio".
     */
    conferir('fixo sem pessoa não escolhe ninguém', escolherDono(equipe, FIXO(null)), null)
    conferir(
        'fixo apontando para quem não está na lista cai na fila geral',
        escolherDono(equipe, FIXO('quem-saiu-da-clinica')),
        null
    )
    conferir(
        'e não escolhe outra pessoa no lugar — fila geral, nunca rodízio',
        escolherDono(equipe, FIXO('quem-saiu-da-clinica')) === 'ana' ||
            escolherDono(equipe, FIXO('quem-saiu-da-clinica')) === 'bia',
        false
    )

    // Com o interruptor ligado, o fixo ausente também cai na fila: quem configurou
    // "só disponíveis" pediu para o lead não ficar parado com quem não vai olhar.
    const agora = em('2026-11-26T20:00:00Z')
    const paradoHa = (min: number) => new Date(agora.getTime() - min * 60_000)
    const comInterruptor: PoliticaDeDistribuicao = { ...FIXO('ana'), soDisponiveis: true }

    conferir(
        'fixo ausente, interruptor ligado: fila geral',
        escolherDono(
            [membro({ userId: 'ana', ultimaAtividadeEm: paradoHa(600) })],
            comInterruptor,
            60,
            agora
        ),
        null
    )
    conferir(
        'fixo ausente, interruptor desligado: continua sendo dele',
        escolherDono([membro({ userId: 'ana', ultimaAtividadeEm: paradoHa(600) })], FIXO('ana'), 60, agora),
        'ana'
    )
}

// ─────────── A política do CANAL: o que ela decide e o que não decide ───────
//
// O André fixou as opções do canal em 26/11/2026: atendente específico, rodízio
// e balanceamento. O interruptor "só disponíveis" NÃO está entre elas — é da
// conta —, e a composição em `politicaDo` é uma fronteira declarada: um campo
// sempre da conta, dois sempre do canal quando ele fala.
{
    console.log('\nA atribuição do canal — três opções, e a fronteira com a conta')

    conferir('canal sem nada é herança, não `nenhuma`', lerPoliticaDoCanal(null), null)
    conferir('coluna com lixo também cai na herança', lerPoliticaDoCanal('rodizio'), null)
    /**
     * A diferença proposital entre os dois leitores.
     *
     * Na conta, estratégia inválida vira `nenhuma`. No canal, vira **herança**:
     * a coluna do canal só significa "sobrescrevo", e sobrescrita ilegível não é
     * sobrescrita. Resolver como `nenhuma` pararia aquele canal em silêncio por
     * causa de um JSON torto.
     */
    conferir(
        'estratégia inventada no canal cai na herança; na conta vira `nenhuma`',
        [lerPoliticaDoCanal({ estrategia: 'sorteio' }), lerPolitica({ estrategia: 'sorteio' }).estrategia],
        [null, 'nenhuma']
    )

    conferir(
        'as três opções do André são aceitas pelo canal',
        ['fixo', 'rodizio', 'balanceado'].map(
            (e) => lerPoliticaDoCanal({ estrategia: e, donoFixoUserId: 'ana' })?.estrategia ?? null
        ),
        ['fixo', 'rodizio', 'balanceado']
    )

    /**
     * **O canal não guarda o interruptor.** Se um JSON trouxer `soDisponiveis`,
     * ele é descartado na leitura — e tem de ser, senão a tela da conta diria
     * uma coisa e aquele canal faria outra sem ter onde ser configurado.
     */
    conferir(
        'o canal não carrega `soDisponiveis` nem quando ele vem no JSON',
        Object.keys(lerPoliticaDoCanal({ estrategia: 'rodizio', soDisponiveis: true }) ?? {}).sort(),
        ['donoFixoUserId', 'estrategia']
    )

    // A pessoa só dentro de `fixo`, igual ao leitor da conta.
    conferir(
        'canal em rodízio não guarda pessoa',
        lerPoliticaDoCanal({ estrategia: 'rodizio', donoFixoUserId: 'ana' })?.donoFixoUserId,
        null
    )
    conferir(
        'canal em `fixo` sem pessoa continua `fixo`, e a decisão cai na fila geral',
        lerPoliticaDoCanal({ estrategia: 'fixo' }),
        { estrategia: 'fixo', donoFixoUserId: null }
    )
    conferir(
        'e `escolherDono` confirma a queda',
        escolherDono([membro({ userId: 'ana' })], {
            ...(lerPoliticaDoCanal({ estrategia: 'fixo' }) ?? { estrategia: 'nenhuma', donoFixoUserId: null }),
            soDisponiveis: false,
        }),
        null
    )
}

// ──────────────────── A política lida de JSON, nos dois depósitos ────────────
//
// `lerPolitica` é a mesma função para o `automations` da conta e para o
// `distribuicao` da linha. Era validação inline em `automations.ts`, e a lista
// de estratégias válidas morava lá — o que faria a linha aceitar `fixo` e a
// conta não. Estes casos são o que mantém os dois depósitos lendo igual.
{
    console.log('\nA política vem de JSON, e JSON é desconhecido até ser conferido')

    conferir('`fixo` está na lista de estratégias válidas', ESTRATEGIAS.includes('fixo'), true)
    conferir('lixo não derruba: vira o padrão', lerPolitica(null), POLITICA_PADRAO)
    conferir('texto no lugar do objeto também', lerPolitica('rodizio'), POLITICA_PADRAO)
    conferir(
        'estratégia inventada vira `nenhuma`, não erro',
        lerPolitica({ estrategia: 'sorteio' }).estrategia,
        'nenhuma'
    )
    conferir(
        'o que é válido atravessa inteiro',
        lerPolitica({ estrategia: 'rodizio', soDisponiveis: true }),
        { estrategia: 'rodizio', soDisponiveis: true, donoFixoUserId: null }
    )
    conferir(
        'com `fixo`, a pessoa é guardada',
        lerPolitica({ estrategia: 'fixo', donoFixoUserId: 'ana' }).donoFixoUserId,
        'ana'
    )
    /**
     * A pessoa só é guardada **dentro** de `fixo`.
     *
     * Um id que sobrasse de uma troca de estratégia voltaria a valer se alguém
     * devolvesse a linha para `fixo` meses depois — escolhendo, sem saber, uma
     * pessoa que ninguém reviu.
     */
    conferir(
        'fora de `fixo`, a pessoa não sobra no objeto',
        lerPolitica({ estrategia: 'rodizio', donoFixoUserId: 'ana' }).donoFixoUserId,
        null
    )
    conferir(
        '`fixo` com pessoa vazia não inventa uma',
        lerPolitica({ estrategia: 'fixo', donoFixoUserId: '' }).donoFixoUserId,
        null
    )
}

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
