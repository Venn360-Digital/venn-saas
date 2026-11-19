/**
 * O cliente do Venn Desk, visto do app.
 *
 * **O token é buscado no backend do PRÓPRIO app**, nunca aqui: só ele conhece a
 * sessão e tem a chave privada (ADR 0003). O widget pede, guarda em memória, e
 * renova antes de vencer — nunca em `localStorage`, que sobreviveria ao logout.
 *
 * Renova com 60 s de folga porque o token vale 10 minutos: uma aba aberta por
 * meia hora precisa de três renovações, e falhar a renovação tem de parecer
 * "entre de novo", não "o suporte está fora do ar".
 */

const FOLGA_MS = 60_000

export class SemSessao extends Error {
    constructor() {
        super('Sem sessão no app.')
        this.name = 'SemSessao'
    }
}

export interface Contadores {
    abertos: number
    emAndamento: number
    naoLidas: number
}

export interface ChamadoResumo {
    numero: string
    assunto: string
    grupo: 'abertos' | 'em_andamento' | 'fechados'
    status: string
    tipo: string
    prioridade: string
    criadoEm: string
    atualizadoEm: string
}

/** A nota de satisfação daquele chamado, do ponto de vista de quem abre. */
export interface CsatDoChamado {
    /** Encerrado E de quem está olhando. Quem lê chamado da colega não avalia. */
    podeAvaliar: boolean
    /** A nota já dada, ou nulo. Serve para NÃO perguntar duas vezes. */
    nota: number | null
}

export interface MensagemPublica {
    id: string
    autor: 'USUARIO' | 'IA' | 'HUMANO' | 'SISTEMA'
    corpo: string
    criadoEm: string
}

export interface Anexo {
    id: string
    nome: string
    tipo: string
    tamanho: number
}

/**
 * O tema vem do Venn Desk, não de props do app.
 *
 * Mudar a cor do widget passa a ser um clique no Console, e não um deploy do
 * app — a pessoa que decide a cor não é a que faz deploy.
 */
export interface TemaDoWidget {
    corDeDestaque?: string
    corSobreDestaque?: string
    posicao: 'direita' | 'esquerda'
    margem: number
    atendente: { nome?: string; avatar?: string }
    saudacao?: string
    organizacao?: string
    modulos: string[]
    mostrarBotao: boolean
}

export interface Eu {
    usuario: { nome: string; email: string; veDaEmpresa: boolean }
    app: { slug: string; nome: string; prefixo: string }
    tema?: TemaDoWidget
    contadores: Contadores
}

export class ClienteDoDesk {
    private token: string | null = null
    private expiraEm = 0
    private emVoo: Promise<string> | null = null

    /// Sem parameter property: é a convenção do repositório (ver CLAUDE.md),
    /// para qualquer .ts rodar direto no Node, sem transformação.
    private readonly base: string
    private readonly app: string
    private readonly rotaDoToken: string

    constructor(base: string, app: string, rotaDoToken: string) {
        this.base = base
        this.app = app
        this.rotaDoToken = rotaDoToken
    }

    /** Uma renovação por vez: dez telas abrindo juntas não geram dez chamadas. */
    private async obterToken(): Promise<string> {
        if (this.token !== null && Date.now() < this.expiraEm - FOLGA_MS) return this.token
        if (this.emVoo !== null) return this.emVoo

        this.emVoo = (async () => {
            const r = await fetch(this.rotaDoToken, {
                method: 'POST',
                credentials: 'same-origin',
            })

            if (r.status === 401 || r.status === 403) throw new SemSessao()
            if (!r.ok) throw new Error('Falha ao obter o token de suporte.')

            const dados = (await r.json()) as { token?: string; expiraEm?: number }
            if (typeof dados.token !== 'string') throw new Error('Token ausente na resposta.')

            this.token = dados.token
            /// Se o app não informar, assume 10 min — o teto que o Desk aceita.
            this.expiraEm = dados.expiraEm ?? Date.now() + 600_000
            return dados.token
        })()

        try {
            return await this.emVoo
        } finally {
            this.emVoo = null
        }
    }

    private async chamar<T>(
        caminho: string,
        opcoes: { metodo?: string; corpo?: unknown; forma?: FormData } = {}
    ): Promise<T> {
        const token = await this.obterToken()
        const r = await fetch(`${this.base}/api/app/${this.app}${caminho}`, {
            method: opcoes.metodo ?? 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                ...(opcoes.corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
            ...(opcoes.forma === undefined ? {} : { body: opcoes.forma }),
        })

        if (r.status === 401) {
            /// Token recusado: descarta e deixa a próxima chamada renovar.
            this.token = null
            throw new SemSessao()
        }

        const texto = await r.text()
        const dados = texto === '' ? {} : (JSON.parse(texto) as Record<string, unknown>)

        if (!r.ok) {
            const erro = dados['erro'] as { mensagem?: string } | undefined
            throw new Error(erro?.mensagem ?? 'Não foi possível concluir.')
        }

        return dados as T
    }

    eu(): Promise<Eu> {
        return this.chamar('/eu')
    }

    meusChamados(grupo?: string, daEmpresa = false): Promise<{ chamados: ChamadoResumo[] }> {
        const busca = new URLSearchParams()
        if (grupo) busca.set('grupo', grupo)
        if (daEmpresa) busca.set('escopo', 'empresa')
        const q = busca.toString()
        return this.chamar(`/chamados${q === '' ? '' : `?${q}`}`)
    }

    chamado(numero: string): Promise<{
        chamado: ChamadoResumo
        csat: CsatDoChamado
        mensagens: MensagemPublica[]
        anexos: Anexo[]
    }> {
        return this.chamar(`/chamados/${numero}`)
    }

    /**
     * A nota de satisfação. Uma por chamado — reavaliar substitui.
     *
     * `atendidoPelaIa` NÃO vai daqui: o servidor deduz das mensagens do
     * chamado. Mandá-lo daqui tornaria editável, por quem responde, a métrica
     * que decide se o atendimento automático é ligado no app.
     */
    avaliar(numero: string, nota: number, comentario?: string): Promise<{ nota: number }> {
        return this.chamar(`/chamados/${numero}/csat`, {
            metodo: 'POST',
            corpo: { nota, ...(comentario === undefined ? {} : { comentario }) },
        })
    }

    abrir(dados: {
        assunto: string
        descricao: string
        modulo?: string
        impacto: string
        contexto: unknown
    }): Promise<{ chamado: ChamadoResumo }> {
        return this.chamar('/chamados', { metodo: 'POST', corpo: dados })
    }

    responder(numero: string, corpo: string): Promise<{ chamado: ChamadoResumo }> {
        return this.chamar(`/chamados/${numero}/mensagens`, { metodo: 'POST', corpo: { corpo } })
    }

    anexar(numero: string, arquivo: File): Promise<{ anexo: Anexo }> {
        const forma = new FormData()
        forma.append('arquivo', arquivo)
        return this.chamar(`/chamados/${numero}/anexos`, { metodo: 'POST', forma })
    }

    linkDoAnexo(numero: string, id: string): Promise<{ url: string; nome: string }> {
        return this.chamar(`/chamados/${numero}/anexos/${encodeURIComponent(id)}`)
    }
}
