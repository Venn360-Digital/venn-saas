import { useCallback, useEffect, useRef, useState } from 'react'

import { atualizarNaoLidas, registrarPonte } from './lib/ponte'
import { useVennDesk } from './VennDeskProvider'
import { Abrir } from './telas/Abrir'
import { Meus } from './telas/Meus'
import { Chamado } from './telas/Chamado'

type Tela = { nome: 'inicio' } | { nome: 'abrir' } | { nome: 'meus' } | { nome: 'chamado'; numero: string }

/**
 * O botão flutuante e o painel.
 *
 * **Só aparece para quem tem sessão.** Sem token o app não emite nada e o
 * widget não renderiza — é a garantia de "apenas usuários logados" da seção 7,
 * e ela vale também visualmente: um botão de suporte numa tela deslogada
 * convidaria a abrir chamado que o Desk vai recusar.
 *
 * Acessibilidade: o painel é um diálogo com rótulo, fecha no Esc, devolve o
 * foco ao botão e prende o foco dentro enquanto está aberto.
 */
export function VennDeskLauncher({ flutuante = true }: { flutuante?: boolean } = {}) {
    const { t, contadores, painelAberto, setPainelAberto, semSessao, eu, falha, tema } =
        useVennDesk()
    const [tela, setTela] = useState<Tela>({ nome: 'inicio' })
    const [recado, setRecado] = useState<string | null>(null)
    const botao = useRef<HTMLButtonElement>(null)
    const painel = useRef<HTMLDivElement>(null)
    /**
     * Quem tinha o foco quando o painel abriu.
     *
     * Era `botao.current` que recebia o foco de volta, e isso deixou de bastar
     * quando o botão flutuante passou a poder não existir: fechando o painel, o
     * foco caía no `body` e quem navega por teclado voltava ao começo da página.
     * Agora o foco volta para onde saiu — a pílula, o botão da barra de cima, ou
     * o que mais tiver aberto o painel.
     */
    const focoAnterior = useRef<HTMLElement | null>(null)

    // Guarda o foco no instante em que o painel abre, antes de a prisão de foco
    // mover qualquer coisa.
    useEffect(() => {
        if (!painelAberto) return
        const ativo = document.activeElement
        focoAnterior.current = ativo instanceof HTMLElement ? ativo : null
    }, [painelAberto])

    // `useCallback` porque a prisão de foco abaixo a captura num efeito: sem
    // identidade estável, o efeito se desinscreveria e reinscreveria a cada
    // tecla digitada no painel.
    const devolverFoco = useCallback(() => {
        const alvo = focoAnterior.current ?? botao.current
        alvo?.focus()
    }, [])

    useEffect(() => {
        if (!painelAberto) return

        const aoTeclar = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setPainelAberto(false)
                devolverFoco()
                return
            }

            if (e.key !== 'Tab' || painel.current === null) return

            /// Prisão de foco: sem isso o Tab sai do diálogo para a página
            /// atrás, que para leitor de tela é como se o painel não existisse.
            const focaveis = painel.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), textarea, select, a[href]'
            )
            const primeiro = focaveis[0]
            const ultimo = focaveis[focaveis.length - 1]
            if (primeiro === undefined || ultimo === undefined) return

            if (e.shiftKey && document.activeElement === primeiro) {
                e.preventDefault()
                ultimo.focus()
            } else if (!e.shiftKey && document.activeElement === ultimo) {
                e.preventDefault()
                primeiro.focus()
            }
        }

        document.addEventListener('keydown', aoTeclar)
        return () => document.removeEventListener('keydown', aoTeclar)
    }, [painelAberto, setPainelAberto, devolverFoco])

    /**
     * Anuncia-se ao app hospedeiro — para que algo FORA do widget possa abrir
     * o painel. Ver `lib/ponte.ts`.
     *
     * Depois das guardas de sessão não daria: o `if` abaixo retorna antes, e
     * efeito não roda depois de um retorno. Então a condição mora dentro.
     */
    const temSessao = !semSessao && eu !== null

    /**
     * O registro é de MONTAGEM, e por isso o abridor vai por `ref`.
     *
     * Pondo `setPainelAberto` nas dependências, o efeito refazia o registro
     * sempre que a identidade dela mudasse — e cada registro novo passa pela
     * baixa do anterior, que publica "indisponível": o botão do app piscava.
     * A `ref` mantém o efeito com dependência única e o abridor sempre atual.
     */
    const abrirRef = useRef(setPainelAberto)
    // Escrita em efeito, não no render: `react-hooks/refs` acusa a mutação
    // durante o render, e com razão — é o mesmo padrão dos outros `*Ref` da casa.
    useEffect(() => {
        abrirRef.current = setPainelAberto
    }, [setPainelAberto])

    useEffect(() => {
        if (!temSessao) return
        return registrarPonte(() => abrirRef.current(true))
    }, [temSessao])

    // O contador anda sozinho, no ritmo dele. Ver `atualizarNaoLidas`.
    useEffect(() => {
        atualizarNaoLidas(contadores.naoLidas)
    }, [contadores.naoLidas])

    if (semSessao || eu === null) return null

    /**
     * O botão flutuante some por duas razões, e elas são diferentes.
     *
     * `mostrarBotao` vem do Console do Venn Desk e serve a desligar o suporte
     * de fora — numa migração, por exemplo. O painel continua funcionando por
     * `setPainelAberto`, então quem já estava com ele aberto não é interrompido.
     *
     * `flutuante` vem do app, e nos nossos três painéis é `false`: o canto
     * inferior direito **tem controle**. Na tela de Conversas o botão Enviar
     * fica exatamente ali, e a pílula ficava em cima dele. Trocar de canto não
     * resolveria — o inferior esquerdo é o rodapé da sidebar. Quem abre o painel
     * é a barra de cima, pela ponte (`lib/ponte.ts`).
     */
    const escondido = tema?.mostrarBotao === false || !flutuante

    /**
     * As variáveis do tema entram na RAIZ DO WIDGET, nunca no `:root`.
     *
     * Escrevê-las no documento mudaria a cor do app hospedeiro — o widget
     * estaria pintando a casa dos outros. Aqui a cascata alcança só o que está
     * dentro dele.
     */
    const estilo: Record<string, string> = {}
    if (tema?.corDeDestaque !== undefined) {
        estilo['--vd-destaque'] = tema.corDeDestaque
        if (tema.corSobreDestaque !== undefined) {
            estilo['--vd-destaque-tinta'] = tema.corSobreDestaque
        }
    }
    if (tema !== null) estilo['--vd-margem'] = `${tema.margem}px`

    const naoLidas = contadores.naoLidas

    return (
        <div
            className="vd-raiz"
            data-posicao={tema?.posicao ?? 'direita'}
            style={estilo as React.CSSProperties}
        >
            {!painelAberto && !escondido && (
                <button
                    ref={botao}
                    type="button"
                    className="vd-botao-flutuante"
                    onClick={() => setPainelAberto(true)}
                    aria-haspopup="dialog"
                >
                    {t('suporte')}
                    {naoLidas > 0 && (
                        <>
                            <span className="vd-selo" aria-hidden="true">
                                {naoLidas > 9 ? '9+' : naoLidas}
                            </span>
                            <span className="vd-oculto-visualmente">
                                {naoLidas} {t('abertos')}
                            </span>
                        </>
                    )}
                </button>
            )}

            {painelAberto && (
                <div
                    ref={painel}
                    className="vd-painel"
                    role="dialog"
                    aria-modal="true"
                    aria-label={t('suporte')}
                >
                    <header className="vd-cabecalho">
                        <h2 className="vd-titulo">{t('suporte')}</h2>
                        <button
                            type="button"
                            className="vd-botao-icone"
                            aria-label={t('fechar')}
                            onClick={() => {
                                setPainelAberto(false)
                                devolverFoco()
                            }}
                        >
                            ✕
                        </button>
                    </header>

                    <div className="vd-corpo">
                        {recado !== null && <p className="vd-nota">{recado}</p>}
                        {falha !== null && <p className="vd-aviso">{falha}</p>}

                        {tela.nome === 'inicio' && (
                            <>
                                <p className="vd-nota">
                                    {eu.usuario.nome} · {eu.app.nome}
                                </p>
                                <button
                                    type="button"
                                    className="vd-botao"
                                    data-variante="solido"
                                    onClick={() => {
                                        setRecado(null)
                                        setTela({ nome: 'abrir' })
                                    }}
                                >
                                    {t('abrirChamado')}
                                </button>
                                <button
                                    type="button"
                                    className="vd-botao"
                                    onClick={() => setTela({ nome: 'meus' })}
                                >
                                    {t('meusChamados')}
                                    {contadores.abertos > 0 && ` (${contadores.abertos})`}
                                </button>
                            </>
                        )}

                        {tela.nome === 'abrir' && (
                            <Abrir
                                aoCriar={(numero) => {
                                    setRecado(t('criado', { numero }))
                                    setTela({ nome: 'meus' })
                                }}
                            />
                        )}

                        {tela.nome === 'meus' && (
                            <>
                                <button
                                    type="button"
                                    className="vd-botao"
                                    onClick={() => setTela({ nome: 'inicio' })}
                                >
                                    ← {t('voltar')}
                                </button>
                                <Meus aoAbrir={(numero) => setTela({ nome: 'chamado', numero })} />
                            </>
                        )}

                        {tela.nome === 'chamado' && (
                            <Chamado numero={tela.numero} aoVoltar={() => setTela({ nome: 'meus' })} />
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
