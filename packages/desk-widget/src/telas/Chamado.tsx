import { useEffect, useState } from 'react'

import { useVennDesk } from '../VennDeskProvider'
import type { Anexo, ChamadoResumo, CsatDoChamado, MensagemPublica } from '../lib/api'

/**
 * A tela de um chamado, como o usuário a vê: só mensagem pública.
 *
 * Nota interna não chega aqui porque o servidor não a manda — a rota do
 * solicitante filtra por visibilidade (ver `escopo.mensagens.publicas`). A tela
 * não tem como vazar o que nunca recebeu, e isso é de propósito: filtrar no
 * cliente deixaria o dado interno viajando no JSON.
 */
export function Chamado({ numero, aoVoltar }: { numero: string; aoVoltar: () => void }) {
    const { cliente, t, recarregarEu } = useVennDesk()
    const [dados, setDados] = useState<{
        chamado: ChamadoResumo
        csat: CsatDoChamado
        mensagens: MensagemPublica[]
        anexos: Anexo[]
    } | null>(null)
    const [resposta, setResposta] = useState('')
    const [enviando, setEnviando] = useState(false)
    const [erro, setErro] = useState<string | null>(null)

    async function carregar() {
        try {
            setDados(await cliente.chamado(numero))
        } catch (falha) {
            setErro(falha instanceof Error ? falha.message : t('falhou'))
        }
    }

    useEffect(() => {
        void carregar()
        /// Enquanto o chamado está aberto na tela, 15 s: é a janela em que uma
        /// resposta do suporte deve aparecer sem a pessoa recarregar.
        const timer = window.setInterval(() => void carregar(), 15_000)
        return () => window.clearInterval(timer)
    }, [cliente, numero])

    async function responder() {
        setEnviando(true)
        setErro(null)
        try {
            await cliente.responder(numero, resposta)
            setResposta('')
            await carregar()
            recarregarEu()
        } catch (falha) {
            setErro(falha instanceof Error ? falha.message : t('falhou'))
        } finally {
            setEnviando(false)
        }
    }

    async function baixar(anexo: Anexo) {
        try {
            const { url } = await cliente.linkDoAnexo(numero, anexo.id)
            window.open(url, '_blank', 'noopener')
        } catch {
            setErro(t('falhou'))
        }
    }

    if (dados === null) {
        return (
            <>
                <button type="button" className="vd-botao" onClick={aoVoltar}>
                    ← {t('voltar')}
                </button>
                <p className="vd-vazio">{erro ?? t('carregando')}</p>
            </>
        )
    }

    const { chamado, mensagens, anexos } = dados
    const fechado = chamado.grupo === 'fechados'

    return (
        <>
            <button type="button" className="vd-botao" onClick={aoVoltar}>
                ← {t('voltar')}
            </button>

            <div>
                <span className="vd-linha">
                    <span className="vd-numero">{chamado.numero}</span>
                    <span className="vd-estado" data-grupo={chamado.grupo}>
                        {chamado.status.toLowerCase().replace(/_/g, ' ')}
                    </span>
                </span>
                <h3 className="vd-titulo" style={{ marginBlockStart: '0.25rem' }}>
                    {chamado.assunto}
                </h3>
            </div>

            {/* A etapa da engenharia é o que o usuário vê de "em espera": ele
                não precisa saber de issue nem de PR, mas precisa saber que
                alguém está mexendo (seção 5). */}
            {chamado.grupo === 'em_andamento' && (
                <p className="vd-nota">{t('etapaEngenharia')}: {chamado.status.toLowerCase()}</p>
            )}

            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
                {mensagens.map((m) => (
                    <li key={m.id} className="vd-mensagem" data-autor={m.autor}>
                        <span className="vd-autor">
                            {m.autor === 'USUARIO' ? t('voce') : t('suporteNome')}
                        </span>
                        <span style={{ whiteSpace: 'pre-wrap' }}>{m.corpo}</span>
                    </li>
                ))}
            </ol>

            {anexos.length > 0 && (
                <div>
                    <p className="vd-nota" style={{ fontWeight: 600 }}>{t('anexos')}</p>
                    <ul style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
                        {anexos.map((a) => (
                            <li key={a.id} className="vd-nota">
                                <button
                                    type="button"
                                    className="vd-botao"
                                    style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem' }}
                                    onClick={() => void baixar(a)}
                                >
                                    {a.nome}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {erro !== null && <p className="vd-aviso">{erro}</p>}

            <label className="vd-campo">
                <span>{fechado ? t('suaResposta') : t('suaResposta')}</span>
                <textarea
                    value={resposta}
                    onChange={(e) => setResposta(e.target.value)}
                    rows={3}
                    placeholder={t('suaResposta')}
                />
            </label>

            <button
                type="button"
                className="vd-botao"
                data-variante="solido"
                disabled={enviando || resposta.trim() === ''}
                onClick={() => void responder()}
            >
                {enviando ? t('enviando') : t('responder')}
            </button>

            {/* Chamado fechado é imutável: a resposta gera chamado de
                acompanhamento, e o servidor devolve o novo número. */}
            {fechado && <p className="vd-nota">{t('issoResolveu')}</p>}

            {dados.csat.podeAvaliar && (
                <Avaliacao
                    numero={numero}
                    jaDada={dados.csat.nota}
                    aoAvaliar={() => void carregar()}
                />
            )}
        </>
    )
}

/**
 * A nota de satisfação, de um a cinco.
 *
 * **Por que cinco botões e não "sim/não".** A revisão semanal procura resposta
 * com nota BAIXA, e num binário não existe baixa — existe "não", que mistura
 * "não resolveu" com "resolveu mal". São os dois casos que a revisão precisa
 * separar, e quem lê cem respostas por semana precisa dessa separação para
 * saber onde olhar primeiro.
 *
 * **O comentário só aparece DEPOIS da nota.** Pedir os dois de uma vez
 * transforma um clique em formulário, e formulário espanta a maioria. Com a
 * nota já registrada, quem quiser falar mais fala; quem não quiser já
 * contribuiu.
 */
function Avaliacao({
    numero,
    jaDada,
    aoAvaliar,
}: {
    numero: string
    jaDada: number | null
    aoAvaliar: () => void
}) {
    const { cliente, t } = useVennDesk()
    const [nota, setNota] = useState<number | null>(jaDada)
    const [comentario, setComentario] = useState('')
    const [enviandoComentario, setEnviando] = useState(false)
    /// Some assim que a pessoa manda o comentário: deixar o campo aberto
    /// sugere que ainda falta alguma coisa dela.
    const [agradeceu, setAgradeceu] = useState(jaDada !== null)

    async function avaliar(valor: number) {
        /// Pinta ANTES da resposta do servidor: o clique precisa responder na
        /// hora, e uma nota que não gravou é recuperável — a pessoa clica de
        /// novo, e o servidor substitui em vez de acumular.
        setNota(valor)
        try {
            await cliente.avaliar(numero, valor)
            aoAvaliar()
        } catch {
            setNota(jaDada)
        }
    }

    async function comentar() {
        if (nota === null || comentario.trim() === '') return
        setEnviando(true)
        try {
            await cliente.avaliar(numero, nota, comentario.trim())
            setAgradeceu(true)
        } finally {
            setEnviando(false)
        }
    }

    return (
        <div className="vd-avaliacao">
            <p className="vd-nota">{t('comoFoiOAtendimento')}</p>

            <div className="vd-estrelas" role="group" aria-label={t('comoFoiOAtendimento')}>
                <span className="vd-ponta">{t('notaRuim')}</span>
                {[1, 2, 3, 4, 5].map((valor) => (
                    <button
                        key={valor}
                        type="button"
                        className="vd-estrela"
                        aria-pressed={nota === valor}
                        /// O rótulo diz "N de 5": só o número soaria como
                        /// posição numa lista para quem usa leitor de tela.
                        aria-label={`${valor} / 5`}
                        data-escolhida={nota !== null && valor <= nota ? 'sim' : undefined}
                        onClick={() => void avaliar(valor)}
                    >
                        ★
                    </button>
                ))}
                <span className="vd-ponta">{t('notaOtima')}</span>
            </div>

            {nota !== null && !agradeceu && (
                <>
                    {/* `.vd-campo` é a convenção da casa: o rótulo envolve o
                        controle, com o texto num `span`. Criar classe nova aqui
                        daria um campo com outra cara dentro do mesmo painel. */}
                    <label className="vd-campo">
                        <span>{t('contarMais')}</span>
                        <textarea
                            rows={2}
                            maxLength={600}
                            value={comentario}
                            onChange={(e) => setComentario(e.target.value)}
                        />
                    </label>
                    <button
                        type="button"
                        className="vd-botao"
                        data-variante="leve"
                        disabled={enviandoComentario || comentario.trim() === ''}
                        onClick={() => void comentar()}
                    >
                        {t('enviarNota')}
                    </button>
                </>
            )}

            {agradeceu && nota !== null && (
                <p className="vd-nota">
                    {t('suaNota', { nota: String(nota) })} {t('obrigadoPelaNota')}
                </p>
            )}
        </div>
    )
}
