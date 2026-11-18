import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
    ClienteDoDesk,
    SemSessao,
    type Contadores,
    type Eu,
    type TemaDoWidget,
} from './lib/api'
import { instalarGravadores } from './lib/contexto'
import { idiomaDoDocumento, tradutor, type Idioma } from './lib/i18n'

/**
 * O provider. Três responsabilidades, e nenhuma de negócio (ADR 0002): guarda a
 * configuração, mantém o cliente da API, e consulta os contadores do selo.
 *
 * O intervalo muda com o estado: 20 s com o painel aberto, 60 s fechado, e nada
 * quando a aba está escondida. Uma tela de clínica fica aberta o dia inteiro —
 * consultar a cada 20 s por oito horas sem ninguém olhando seria mil chamadas
 * por aba, por nada.
 */

export interface Textos {
    /** Vocabulário do nicho: "clínica" no Odontobox, "agência" no Conecta. */
    organizacao?: string
}

interface Config {
    cliente: ClienteDoDesk
    app: string
    t: ReturnType<typeof tradutor>
    idioma: Idioma
    textos: Textos
    /** O tema vindo do Venn Desk. Nulo enquanto `/eu` não voltou. */
    tema: TemaDoWidget | null
    modulos: string[]
    versaoDoApp?: string
    eu: Eu | null
    contadores: Contadores
    semSessao: boolean
    /** Falha que não é de sessão. Visível para não confundir com "carregando". */
    falha: string | null
    recarregarEu: () => void
    painelAberto: boolean
    setPainelAberto: (v: boolean) => void
}

const Contexto = createContext<Config | null>(null)

export function useVennDesk(): Config {
    const c = useContext(Contexto)
    if (c === null) {
        throw new Error('useVennDesk precisa estar dentro de <VennDeskProvider>.')
    }
    return c
}

export function VennDeskProvider({
    children,
    app,
    base = '',
    tokenEndpoint = '/api/venn-desk/token',
    idioma,
    textos = {},
    modulos = [],
    versaoDoApp,
}: {
    children: ReactNode
    /** Slug do app no Venn Desk: `odontobox`, `conecta`, `stagent`. */
    app: string
    /** Origem do Venn Desk. Vazio = mesma origem, via proxy do app. */
    base?: string
    /** Rota do próprio app que assina o token (ADR 0003). */
    tokenEndpoint?: string
    idioma?: Idioma
    textos?: Textos
    /** Lista de módulos do app, para o usuário dizer onde aconteceu. */
    modulos?: string[]
    versaoDoApp?: string
}) {
    const [eu, setEu] = useState<Eu | null>(null)
    const [semSessao, setSemSessao] = useState(false)
    const [falha, setFalha] = useState<string | null>(null)
    const [painelAberto, setPainelAberto] = useState(false)
    const [gatilho, setGatilho] = useState(0)

    const cliente = useMemo(
        () => new ClienteDoDesk(base, app, tokenEndpoint),
        [base, app, tokenEndpoint]
    )

    const efetivo = idioma ?? idiomaDoDocumento()
    const t = useMemo(() => tradutor(efetivo), [efetivo])

    /// Os gravadores precisam estar de pé ANTES do erro acontecer, então sobem
    /// na montagem — não quando o usuário abre o widget.
    useEffect(() => instalarGravadores(), [])

    const aberto = useRef(painelAberto)
    aberto.current = painelAberto

    useEffect(() => {
        let vivo = true
        let timer: number | undefined
        let jaCarregou = false

        async function consultar() {
            if (!vivo) return

            /**
             * A aba oculta adia a REPETIÇÃO, nunca a primeira carga.
             *
             * Medido em 16/11/2026: com a verificação antes da primeira busca, um
             * widget montado numa aba de fundo ficava invisível por 30 s — e num
             * contexto que nunca ganha foco, para sempre. O selo existe
             * justamente para quem não está olhando agora.
             */
            if (jaCarregou && document.visibilityState === 'hidden') {
                timer = window.setTimeout(consultar, 30_000)
                return
            }

            try {
                const dados = await cliente.eu()
                if (!vivo) return
                jaCarregou = true
                setEu(dados)
                setSemSessao(false)
                setFalha(null)
            } catch (erro) {
                if (!vivo) return
                if (erro instanceof SemSessao) {
                    setSemSessao(true)
                } else {
                    /**
                     * Falha que não é de sessão fica REGISTRADA. Antes ela era
                     * engolida, e aí "não carregou" e "está carregando" ficavam
                     * indistinguíveis — foi o que escondeu o defeito acima.
                     */
                    setFalha(erro instanceof Error ? erro.message : String(erro))
                }
            }

            timer = window.setTimeout(consultar, aberto.current ? 20_000 : 60_000)
        }

        void consultar()

        const aoVoltar = () => {
            if (document.visibilityState === 'visible') {
                window.clearTimeout(timer)
                void consultar()
            }
        }
        document.addEventListener('visibilitychange', aoVoltar)

        return () => {
            vivo = false
            window.clearTimeout(timer)
            document.removeEventListener('visibilitychange', aoVoltar)
        }
    }, [cliente, gatilho])

    /**
     * O tema vem do servidor; as props do app são a QUEDA.
     *
     * A ordem importa e é esta de propósito: o Console é a fonte da verdade
     * para aparência e vocabulário, e o que o app passa serve enquanto o `/eu`
     * não voltou — ou quando ninguém configurou nada lá. Fosse ao contrário,
     * mudar a cor no Console não mudaria nada e a tela mentiria.
     */
    const tema = eu?.tema ?? null

    const valor: Config = {
        cliente,
        app,
        t,
        idioma: efetivo,
        textos: {
            ...textos,
            ...(tema?.organizacao === undefined ? {} : { organizacao: tema.organizacao }),
        },
        tema,
        modulos: tema?.modulos?.length ? tema.modulos : modulos,
        ...(versaoDoApp === undefined ? {} : { versaoDoApp }),
        eu,
        contadores: eu?.contadores ?? { abertos: 0, emAndamento: 0, naoLidas: 0 },
        semSessao,
        falha,
        recarregarEu: () => setGatilho((n) => n + 1),
        painelAberto,
        setPainelAberto,
    }

    return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}
