import { useEffect, useState } from 'react'

import { useVennDesk } from '../VennDeskProvider'
import type { Anexo, ChamadoResumo, MensagemPublica } from '../lib/api'

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
        </>
    )
}
