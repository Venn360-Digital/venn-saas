'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { Logo } from '@/components/brand/Logo'
import { cn } from '@/lib/utils'

/** Avisa a sidebar que a logo mudou, sem recarregar a página. */
export const WORKSPACE_UPDATED = 'workspace:updated'

/**
 * A marca no topo da sidebar.
 *
 * A guia Clínica promete que a logo enviada "substitui a logo do OdontoBox360
 * no menu lateral", e isso não acontecia: o cabeçalho desenhava sempre o
 * símbolo e o nome do produto, e ninguém lia `workspace.logo`. A imagem ficava
 * gravada no banco e não aparecia em lugar nenhum.
 *
 * Com logo da clínica, ela toma o lugar do símbolo **e** do nome — é uma marca
 * no lugar de outra, não as duas lado a lado. Na calha recolhida volta o
 * símbolo: um lockup de 160 × 25 px não cabe num quadrado de 32.
 */
export function ClinicBrand() {
    const [logo, setLogo] = useState<string | null>(null)
    const [name, setName] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false

        const load = () => {
            fetch('/api/account/workspace')
                .then((r) => (r.ok ? r.json() : null))
                .then((data) => {
                    if (cancelled || !data) return
                    setLogo(data.logo ?? null)
                    setName(data.name ?? null)
                })
                .catch(() => {
                    // Sem resposta, fica a marca do produto.
                })
        }

        load()
        window.addEventListener(WORKSPACE_UPDATED, load)
        return () => {
            cancelled = true
            window.removeEventListener(WORKSPACE_UPDATED, load)
        }
    }, [])

    return (
        <Link href="/dashboard" aria-label={logo ? (name ?? 'Início') : 'OdontoBox360'}>
            <span
                className={cn(
                    'aspect-square size-8 shrink-0 items-center justify-center',
                    logo ? 'hidden group-data-[collapsible=icon]:flex' : 'flex'
                )}
            >
                <Logo variant="mark" height={30} priority />
            </span>

            {logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- a logo da
                // clínica é um data URL gravado no workspace, não um arquivo do
                // projeto: o otimizador do Next não tem o que fazer com ela.
                <img
                    src={logo}
                    alt={name ?? 'Logo da clínica'}
                    className="h-[26px] w-auto max-w-[168px] object-contain group-data-[collapsible=icon]:hidden"
                />
            ) : (
                <span className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-semibold">OdontoBox360</span>
                    <span className="truncate text-xs text-sidebar-foreground/70">
                        Atendimento com IA
                    </span>
                </span>
            )}
        </Link>
    )
}
