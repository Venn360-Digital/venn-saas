import { useState } from 'react'

import { useVennDesk } from '../VennDeskProvider'
import { capturarContexto } from '../lib/contexto'

/**
 * Abrir chamado. O formulário pergunta pouco e captura muito: assunto,
 * descrição, onde e quem afeta — o resto (rota, navegador, erros de console,
 * requisições com falha) vem do contexto, sem o usuário saber que existe.
 *
 * O impacto é pergunta de usuário, não de prioridade: ninguém de fora calibra
 * "alta" contra "urgente", mas todo mundo sabe dizer se está parado.
 */
export function Abrir({ aoCriar }: { aoCriar: (numero: string) => void }) {
    const { cliente, t, modulos, versaoDoApp, recarregarEu } = useVennDesk()
    const [assunto, setAssunto] = useState('')
    const [descricao, setDescricao] = useState('')
    const [modulo, setModulo] = useState('')
    const [impacto, setImpacto] = useState('so_eu')
    const [arquivos, setArquivos] = useState<File[]>([])
    const [enviando, setEnviando] = useState(false)
    const [erro, setErro] = useState<string | null>(null)

    async function enviar(e: React.FormEvent) {
        e.preventDefault()
        setEnviando(true)
        setErro(null)

        try {
            const { chamado } = await cliente.abrir({
                assunto,
                descricao,
                ...(modulo === '' ? {} : { modulo }),
                impacto,
                contexto: capturarContexto(versaoDoApp),
            })

            /**
             * Os anexos vão DEPOIS da criação, um a um. Mandar tudo junto num
             * multipart exigiria uma rota diferente e tornaria a abertura
             * atômica num lugar onde ela não precisa ser: se um anexo falhar, o
             * chamado já existe e a pessoa pode tentar de novo pela tela do
             * chamado. O inverso — perder o relato porque uma imagem falhou —
             * seria pior.
             */
            const numero = chamado.numero.split('-')[1] ?? ''
            for (const arquivo of arquivos) {
                await cliente.anexar(numero, arquivo).catch(() => {
                    setErro(t('falhou'))
                })
            }

            recarregarEu()
            aoCriar(chamado.numero)
        } catch (falha) {
            setErro(falha instanceof Error ? falha.message : t('falhou'))
        } finally {
            setEnviando(false)
        }
    }

    /**
     * A captura de tela entra por import dinâmico: a biblioteca tem algumas
     * centenas de kB e o widget carrega dentro de três apps de produção. Quem
     * nunca clica em "capturar a tela" nunca paga por ela.
     */
    async function capturarTela() {
        setErro(null)
        try {
            const { domToBlob } = await import('modern-screenshot')
            const blob = await domToBlob(document.body, { quality: 0.85, type: 'image/webp' })
            if (blob) {
                setArquivos((atuais) => [
                    ...atuais,
                    new File([blob], `tela-${Date.now()}.webp`, { type: 'image/webp' }),
                ])
            }
        } catch {
            setErro(t('falhou'))
        }
    }

    return (
        <form onSubmit={enviar} style={{ display: 'contents' }}>
            <label className="vd-campo">
                <span>{t('assunto')}</span>
                <input
                    value={assunto}
                    onChange={(e) => setAssunto(e.target.value)}
                    required
                    minLength={3}
                    maxLength={140}
                    autoFocus
                />
            </label>

            <label className="vd-campo">
                <span>{t('descricao')}</span>
                <textarea
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    required
                    minLength={5}
                    rows={5}
                />
            </label>

            {modulos.length > 0 && (
                <label className="vd-campo">
                    <span>{t('modulo')}</span>
                    <select value={modulo} onChange={(e) => setModulo(e.target.value)}>
                        <option value="">—</option>
                        {modulos.map((m) => (
                            <option key={m} value={m}>
                                {m}
                            </option>
                        ))}
                    </select>
                </label>
            )}

            <label className="vd-campo">
                <span>{t('impacto')}</span>
                <select value={impacto} onChange={(e) => setImpacto(e.target.value)}>
                    <option value="so_eu">{t('impactoSoEu')}</option>
                    <option value="minha_equipe">{t('impactoEquipe')}</option>
                    <option value="nao_consigo_trabalhar">{t('impactoParado')}</option>
                </select>
            </label>

            <div className="vd-linha">
                <label className="vd-botao" style={{ cursor: 'pointer' }}>
                    {t('anexar')}
                    <input
                        type="file"
                        multiple
                        accept="image/*,application/pdf,video/mp4,video/webm,text/plain"
                        className="vd-oculto-visualmente"
                        onChange={(e) => setArquivos([...arquivos, ...Array.from(e.target.files ?? [])])}
                    />
                </label>
                <button type="button" className="vd-botao" onClick={() => void capturarTela()}>
                    {t('capturarTela')}
                </button>
            </div>

            {arquivos.length > 0 && (
                <ul className="vd-nota" style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
                    {arquivos.map((a, i) => (
                        <li key={`${a.name}-${i}`}>
                            {a.name} ({Math.round(a.size / 1024)} kB)
                        </li>
                    ))}
                </ul>
            )}

            {/* Pedido da seção 10: avisar antes, não tarjar depois. */}
            <p className="vd-nota">{t('avisoDados')}</p>

            {erro !== null && <p className="vd-aviso">{erro}</p>}

            <button
                type="submit"
                className="vd-botao"
                data-variante="solido"
                disabled={enviando || assunto.trim() === '' || descricao.trim() === ''}
            >
                {enviando ? t('enviando') : t('enviar')}
            </button>
        </form>
    )
}
