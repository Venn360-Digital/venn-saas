'use client'

import Link from 'next/link'

import { Logo } from '@/components/brand/Logo'
import { cn } from '@/lib/utils'
import { useUnidades } from '@/hooks/useUnidades'

/** Reexportado de onde o evento mora agora, para quem já importava daqui. */
export { WORKSPACE_UPDATED } from '@/hooks/useUnidades'

/**
 * A marca no topo da sidebar.
 *
 * A guia Clínica promete que a logo enviada "substitui a logo do OdontoBox360
 * no menu lateral", e isso não acontecia: o cabeçalho desenhava sempre o
 * símbolo e o nome do produto, e ninguém lia a logo gravada. A imagem ficava no
 * banco e não aparecia em lugar nenhum.
 *
 * Com logo da clínica, ela toma o lugar do símbolo **e** do nome — é uma marca
 * no lugar de outra, não as duas lado a lado. Na calha recolhida volta o
 * símbolo: uma logo de clínica não cabe num quadrado de 32.
 *
 * Quem manda é a **largura**: 120px, centrados na calha. Era a altura que
 * mandava, e com um lockup quase quadrado (300 × 170) isso limitava tudo — em
 * 26px de altura a logo saía com 46 de largura, perdida ao lado de um menu de
 * 240. Com a largura fixa, cada clínica entra no mesmo lugar: um brasão alto
 * fica alto, um lettering largo fica baixo, e os dois ocupam a mesma coluna.
 * O teto de altura é só para o caso extremo do retrato.
 *
 * **A logo é da conta, não da unidade** (2026-10-18): o cabeçalho é um por
 * sessão, e a marca é a parte da tela que menos pode piscar — é por ela que a
 * pessoa sabe em que sistema está.
 *
 * **E a marca não é mais o seletor de clínica.** Ele viveu meio dia aqui, na
 * fase 3, e mudou para o cabeçalho (`UnitSwitcher`) por três razões: esta calha
 * recolhe para 32px e levava o seletor embora; a marca já é o link para o
 * início, e um elemento que é link **e** menu não anuncia o que faz; e "em que
 * clínica estou" é estado de sessão, que no cabeçalho fica ao lado do som, dos
 * avisos e do tema. Um seletor para a mesma coisa em dois lugares é o que um dia
 * discorda de si mesmo.
 */
export function ClinicBrand() {
    const { dados } = useUnidades()
    const { logo, name } = dados

    return (
        // O link desenha a si mesmo, em vez de herdar de `SidebarMenuButton`:
        // com `asChild` o filho ficava sem classe nenhuma — nem padding, nem
        // hover, nem anel de foco —, e a marca era o único item do menu sem
        // estado visível.
        <Link
            href="/dashboard"
            aria-label={logo ? (name ?? 'Início') : 'OdontoBox360'}
            className={cn(
                'flex w-full items-center gap-2 rounded-md p-2 outline-hidden transition-colors',
                'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                'group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-start group-data-[collapsible=icon]:p-0!',
                logo ? 'justify-center' : 'h-12'
            )}
        >
            <span
                className={cn(
                    'aspect-square size-8 shrink-0 items-center justify-center',
                    logo ? 'hidden group-data-[collapsible=icon]:flex' : 'flex'
                )}
            >
                <Logo variant="mark" height={30} priority />
            </span>

            {logo ? (
                /* A logo da clínica é um data URL gravado na conta, não um
                   arquivo do projeto: o otimizador do Next não tem o que fazer
                   com ela. */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={logo}
                    alt={name ?? 'Logo da clínica'}
                    className="h-auto max-h-[112px] w-[120px] object-contain group-data-[collapsible=icon]:hidden"
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
