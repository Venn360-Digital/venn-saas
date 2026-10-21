/**
 * As três decisões do canal de WhatsApp, em funções puras.
 *
 * Por que puras: o workerd não roda nesta máquina (macOS 12.7.6 exige 13.5+),
 * então nada que dependa do runtime da Cloudflare pode ser testado antes de
 * publicar. O que sobra é isolar o que erra — quando reiniciar, quando recusar
 * hibernar, quando o vigia age — em funções sem efeito, exercitadas por
 * `verificar.mjs`. A casca (`canal.ts`) só obedece.
 *
 * Todo número aqui é medição registrada no repositório, não estimativa. As
 * fontes estão citadas em cada constante.
 */

// ---------------------------------------------------------------------------
// 1. Reinício depois de parear
// ---------------------------------------------------------------------------

/**
 * O defeito: o Evolution Go mantém a goroutine do QR viva depois do
 * `PairSuccess` e, no quinto QR, desliga a sessão que acabou de criar.
 *
 * Medições em `infra/scripts/wa-guard.sh` e
 * `workers/src/processors/whatsapp-event.ts`:
 *
 *   +16 s   o primeiro número completou o login
 *   +20 s   o processador agendava o reciclo (`RECYCLE_DELAY_MS`)
 *   +35 s   um reinício ANTES do login deixa companheiro meio-registrado, e o
 *           WhatsApp o desliga ~35 s depois (medido em 2026-10-07)
 *   +70 s   teto do vigia: reinicia mesmo sem ver `LoggedIn`
 *   +105 s  o logout forçado chega aqui
 */
export const JANELA = {
    /** Antes disto o login pode não ter completado, e o reinício estraga o pareamento. */
    PISO_MS: 16_000,
    /** Depois disto reinicia sem esperar mais: é o teto do vigia do host. */
    TETO_MS: 70_000,
    /** Depois disto não há o que salvar — o logout forçado já aconteceu. */
    LOGOUT_MS: 105_000,
} as const

export type DecisaoDeReinicio =
    | { acao: 'esperar'; emMs: number; motivo: string }
    | { acao: 'reiniciar'; motivo: string }
    | { acao: 'desistir'; motivo: string }

export interface SituacaoPosPareamento {
    /** Quanto tempo passou desde o `PairSuccess`. */
    desdeParearMs: number
    /** O que `/instance/status` respondeu na última consulta. */
    loggedIn: boolean
    /**
     * Existe aparelho pareado guardado (JID do dono).
     *
     * É o único guarda confiável. `loggedIn` fica `false` durante toda a janela
     * de reconexão pós-pareamento — medido: três minutos inteiros —, e guardar
     * por ele veta exatamente a ação que o tornaria verdadeiro.
     */
    jidConhecido: boolean
}

/** Intervalo entre consultas a `/instance/status` enquanto se espera o login. */
export const PASSO_DE_ESPERA_MS = 5_000

export function decidirReinicio(s: SituacaoPosPareamento): DecisaoDeReinicio {
    if (s.desdeParearMs >= JANELA.LOGOUT_MS) {
        return { acao: 'desistir', motivo: 'janela fechada: o logout forçado já passou' }
    }

    // Reconectar sem aparelho guardado não retoma sessão — abre um ciclo de QR
    // novo, que é o problema, não a cura.
    if (!s.jidConhecido) {
        return { acao: 'desistir', motivo: 'nenhum aparelho pareado para retomar' }
    }

    if (s.desdeParearMs < JANELA.PISO_MS) {
        return {
            acao: 'esperar',
            emMs: Math.min(PASSO_DE_ESPERA_MS, JANELA.PISO_MS - s.desdeParearMs),
            motivo: 'piso da janela: reiniciar agora deixaria companheiro meio-registrado',
        }
    }

    if (s.loggedIn) {
        return { acao: 'reiniciar', motivo: 'login completo' }
    }

    if (s.desdeParearMs >= JANELA.TETO_MS) {
        return { acao: 'reiniciar', motivo: 'teto da janela sem ver LoggedIn' }
    }

    return { acao: 'esperar', emMs: PASSO_DE_ESPERA_MS, motivo: 'aguardando LoggedIn' }
}

// ---------------------------------------------------------------------------
// 2. Recusar hibernar
// ---------------------------------------------------------------------------

/**
 * `sleepAfter` desliga o contêiner por ociosidade, e sessão de WhatsApp não
 * sobrevive a isso: o soquete cai e o número sai do ar até alguém escrever.
 *
 * A documentação da Cloudflare trata a recusa como caminho previsto — se
 * `onActivityExpired()` não chamar `stop()`, o cronômetro renova e o gancho
 * dispara de novo. Então o item 6 da POC (sobreviver a período sem tráfego)
 * não é obstáculo técnico: é decisão de custo.
 *
 * E é só por isso que a decisão mora aqui e não num `sleepAfter = 'never'`:
 * workspace que nunca pareou **deve** dormir, senão paga por contêiner que não
 * serve ninguém.
 */
export type DecisaoDeOcio = { acao: 'dormir' | 'permanecer'; motivo: string }

export function decidirOcio(s: { temAparelhoPareado: boolean; pareandoAgora: boolean }): DecisaoDeOcio {
    if (s.pareandoAgora) {
        return { acao: 'permanecer', motivo: 'pareamento em curso' }
    }
    if (s.temAparelhoPareado) {
        return { acao: 'permanecer', motivo: 'sessão pareada: hibernar tira o número do ar' }
    }
    return { acao: 'dormir', motivo: 'sem sessão pareada: nada a perder e nada a pagar' }
}

// ---------------------------------------------------------------------------
// 3. O vigia
// ---------------------------------------------------------------------------

/**
 * Substitui os dois vigias do host (`wa-guard.sh`, `wa-pool-guard.sh`) por um
 * só, e com um escopo que na VPS não existia.
 *
 * Na VPS, reiniciar o Evolution Go para consertar UM workspace reiniciava a
 * sessão de TODOS — e o contorno só podia morar no host, porque dar o socket do
 * Docker ao worker daria à aplicação controle da máquina inteira (a razão está
 * escrita em `wa-pool-guard.sh`). Com um contêiner por workspace, o reinício
 * atinge só quem pareou, e a autoridade é a do próprio Durable Object sobre o
 * seu contêiner. O contorno feio continua contorno, mas deixa de ser perigoso.
 */
export const VIGIA = {
    /**
     * Teto de um reinício por hora, herdado de `wa-pool-guard.sh`: se a causa
     * for outra, reiniciar em laço não conserta e esconde o motivo.
     */
    MIN_ENTRE_REINICIOS_MS: 3_600_000,
    /** Três rodadas sem resposta antes de reiniciar — uma pode ser rede. */
    FALHAS_PARA_REINICIAR: 3,
    /** Ritmo da ronda. */
    INTERVALO_MS: 300_000,
} as const

export type EstadoObservado = 'saudavel' | 'socket-caido' | 'sem-resposta'

export type DecisaoDoVigia =
    | { acao: 'nada'; motivo: string }
    | { acao: 'reconectar'; motivo: string }
    | { acao: 'reiniciar'; motivo: string }

export interface SituacaoDoVigia {
    estado: EstadoObservado
    temAparelhoPareado: boolean
    falhasSeguidas: number
    /** `null` quando nunca reiniciou nesta instância. */
    desdeUltimoReinicioMs: number | null
}

export function decidirVigia(s: SituacaoDoVigia): DecisaoDoVigia {
    // Sem aparelho pareado não há sessão para defender, e o contêiner já tem
    // permissão para dormir (ver `decidirOcio`).
    if (!s.temAparelhoPareado) {
        return { acao: 'nada', motivo: 'sem sessão pareada' }
    }

    if (s.estado === 'saudavel') {
        return { acao: 'nada', motivo: 'saudável' }
    }

    // Soquete caído com aparelho guardado é o caso barato: `/instance/connect`
    // retoma pelo JID e não emite QR nenhum. Medido na VPS depois de cada
    // reinício, com `CONNECT_ON_STARTUP=true`.
    if (s.estado === 'socket-caido') {
        return { acao: 'reconectar', motivo: 'soquete caído: retomada pelo JID guardado' }
    }

    if (s.falhasSeguidas < VIGIA.FALHAS_PARA_REINICIAR) {
        return {
            acao: 'nada',
            motivo: `sem resposta ${s.falhasSeguidas}/${VIGIA.FALHAS_PARA_REINICIAR}`,
        }
    }

    if (s.desdeUltimoReinicioMs !== null && s.desdeUltimoReinicioMs < VIGIA.MIN_ENTRE_REINICIOS_MS) {
        const faltam = Math.ceil((VIGIA.MIN_ENTRE_REINICIOS_MS - s.desdeUltimoReinicioMs) / 60_000)
        return { acao: 'nada', motivo: `teto de reinícios: ${faltam} min para o próximo` }
    }

    return { acao: 'reiniciar', motivo: `${s.falhasSeguidas} rondas sem resposta` }
}

// ---------------------------------------------------------------------------
// Custo — a conta que decide o modelo, não a viabilidade
// ---------------------------------------------------------------------------

/**
 * Preços da Cloudflare em 2026-10-21, do plano Workers Paid (US$ 5/mês).
 * Memória e disco são cobrados pelo **provisionado**; CPU, pelo **ativo**.
 */
export const PRECO = {
    MEMORIA_GIB_S: 0.0000025,
    CPU_VCPU_S: 0.000020,
    DISCO_GB_S: 0.00000007,
    INCLUSO_MEMORIA_GIB_H: 25,
    INCLUSO_CPU_VCPU_MIN: 375,
    INCLUSO_DISCO_GB_H: 200,
} as const

export const INSTANCIAS = {
    lite: { vcpu: 1 / 16, memoriaGiB: 0.25, discoGB: 2 },
    basic: { vcpu: 1 / 4, memoriaGiB: 1, discoGB: 4 },
    'standard-1': { vcpu: 1 / 2, memoriaGiB: 4, discoGB: 8 },
} as const

export type NomeDeInstancia = keyof typeof INSTANCIAS

/**
 * Custo mensal de N contêineres sempre ligados, em dólares.
 *
 * `fracaoDeCpu` é a fatia do vCPU provisionado que o processo de fato usa — o
 * único insumo que não é tabelado, porque a Cloudflare cobra CPU por uso ativo.
 * O Evolution Go ocioso fica esperando soquete; a POC mede o valor real e esta
 * função deixa de ser estimativa.
 */
export function custoMensal(
    instancia: NomeDeInstancia,
    quantidade: number,
    { horas = 730, fracaoDeCpu = 0.05 }: { horas?: number; fracaoDeCpu?: number } = {}
): { memoria: number; cpu: number; disco: number; total: number } {
    const i = INSTANCIAS[instancia]

    const memoriaGiBh = i.memoriaGiB * horas * quantidade
    const discoGBh = i.discoGB * horas * quantidade
    const cpuMin = i.vcpu * horas * 60 * fracaoDeCpu * quantidade

    const cobra = (usado: number, incluso: number, porSegundo: number, segundosPorUnidade: number) =>
        Math.max(0, usado - incluso) * segundosPorUnidade * porSegundo

    const memoria = cobra(memoriaGiBh, PRECO.INCLUSO_MEMORIA_GIB_H, PRECO.MEMORIA_GIB_S, 3600)
    const disco = cobra(discoGBh, PRECO.INCLUSO_DISCO_GB_H, PRECO.DISCO_GB_S, 3600)
    const cpu = cobra(cpuMin, PRECO.INCLUSO_CPU_VCPU_MIN, PRECO.CPU_VCPU_S, 60)

    const arred = (n: number) => Math.round(n * 100) / 100
    return { memoria: arred(memoria), cpu: arred(cpu), disco: arred(disco), total: arred(memoria + cpu + disco) }
}
