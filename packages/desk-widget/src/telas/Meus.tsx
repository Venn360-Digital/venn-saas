import { useEffect, useState } from 'react'

import { useVennDesk } from '../VennDeskProvider'
import type { ChamadoResumo } from '../lib/api'

const GRUPOS = ['abertos', 'em_andamento', 'fechados'] as const
type Grupo = (typeof GRUPOS)[number]

/**
 * "Meus chamados", nas três abas que a especificação pede (seção 5). O usuário
 * não vê status cru — vê abertos, em andamento e fechados, e é o servidor que
 * traduz, para a tela e a API não discordarem.
 */
export function Meus({ aoAbrir }: { aoAbrir: (numero: string) => void }) {
    const { cliente, t, eu } = useVennDesk()
    const [grupo, setGrupo] = useState<Grupo>('abertos')
    const [daEmpresa, setDaEmpresa] = useState(false)
    const [chamados, setChamados] = useState<ChamadoResumo[] | null>(null)

    useEffect(() => {
        let vivo = true
        setChamados(null)
        cliente
            .meusChamados(grupo, daEmpresa)
            .then((r) => {
                if (vivo) setChamados(r.chamados)
            })
            .catch(() => {
                if (vivo) setChamados([])
            })
        return () => {
            vivo = false
        }
    }, [cliente, grupo, daEmpresa])

    const rotulo: Record<Grupo, string> = {
        abertos: t('abertos'),
        em_andamento: t('emAndamento'),
        fechados: t('fechados'),
    }

    return (
        <>
            <div className="vd-abas" role="tablist" aria-label={t('meusChamados')}>
                {GRUPOS.map((g) => (
                    <button
                        key={g}
                        role="tab"
                        type="button"
                        aria-selected={grupo === g}
                        className="vd-aba"
                        onClick={() => setGrupo(g)}
                    >
                        {rotulo[g]}
                    </button>
                ))}
            </div>

            {eu?.usuario.veDaEmpresa === true && (
                <label className="vd-nota vd-linha" style={{ gap: '0.35rem' }}>
                    <input
                        type="checkbox"
                        checked={daEmpresa}
                        onChange={(e) => setDaEmpresa(e.target.checked)}
                    />
                    {t('daEmpresa')}
                </label>
            )}

            {chamados === null && <p className="vd-vazio">{t('carregando')}</p>}
            {chamados !== null && chamados.length === 0 && (
                <p className="vd-vazio">{t('semChamados')}</p>
            )}

            {chamados?.map((c) => (
                <button
                    key={c.numero}
                    type="button"
                    className="vd-item"
                    onClick={() => aoAbrir(c.numero.split('-')[1] ?? '')}
                >
                    <span className="vd-linha">
                        <span className="vd-numero">{c.numero}</span>
                        <span className="vd-estado" data-grupo={c.grupo}>
                            {rotulo[c.grupo]}
                        </span>
                    </span>
                    <span style={{ display: 'block', marginBlockStart: '0.2rem', fontSize: '0.875rem' }}>
                        {c.assunto}
                    </span>
                </button>
            ))}
        </>
    )
}
