'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronsUpDown } from 'lucide-react'
import { toast } from 'sonner'

import { Logo } from '@/components/brand/Logo'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
 * símbolo: uma logo de clínica não cabe num quadrado de 32.
 *
 * **A logo é da conta, não da unidade** (2026-10-18). O cabeçalho é um por
 * sessão, e uma marca que troca ao trocar de clínica é a parte da tela que
 * menos pode piscar — é por ela que a pessoa sabe em que sistema está. Quem
 * troca ao trocar de clínica é o **nome**, logo abaixo no seletor.
 *
 * Quem manda é a **largura**: 120px, centrados na calha. Era a altura que
 * mandava, e com um lockup quase quadrado (300 × 170) isso limitava tudo — em
 * 26px de altura a logo saía com 46 de largura, perdida ao lado de um menu de
 * 240. Com a largura fixa, cada clínica entra no mesmo lugar: um brasão alto
 * fica alto, um lettering largo fica baixo, e os dois ocupam a mesma coluna.
 * O teto de altura é só para o caso extremo do retrato.
 */
interface Unidade {
    id: string
    name: string
}

export function ClinicBrand() {
    const [logo, setLogo] = useState<string | null>(null)
    const [name, setName] = useState<string | null>(null)
    const [unidades, setUnidades] = useState<Unidade[]>([])
    const [atual, setAtual] = useState<string | null>(null)
    const [trocando, setTrocando] = useState(false)

    useEffect(() => {
        let cancelled = false

        const load = () => {
            fetch('/api/account/workspace')
                .then((r) => (r.ok ? r.json() : null))
                .then((data) => {
                    if (cancelled || !data) return
                    setLogo(data.logo ?? null)
                    setName(data.name ?? null)
                    setAtual(data.id ?? null)
                    setUnidades(Array.isArray(data.unidades) ? data.unidades : [])
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

    /**
     * Troca a unidade aberta e recarrega.
     *
     * Recarga inteira, e não `router.refresh()`: trocar de clínica troca
     * **tudo** — conversas, pacientes, agenda, agentes, limites do plano. Meia
     * tela antiga ao lado de meia tela nova é pior que a espera de um segundo,
     * e é o tipo de estado em que alguém responde o paciente errado.
     */
    const trocar = async (id: string) => {
        if (id === atual || trocando) return
        setTrocando(true)
        try {
            const res = await fetch('/api/workspace/switch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceId: id }),
            })
            if (!res.ok) {
                const erro = await res.json().catch(() => ({}))
                toast.error(erro.error ?? 'Não foi possível trocar de unidade')
                setTrocando(false)
                return
            }
            window.location.reload()
        } catch {
            toast.error('Não foi possível trocar de unidade')
            setTrocando(false)
        }
    }

    const CLASSE_MARCA = cn(
        'flex w-full items-center gap-2 rounded-md p-2 outline-hidden transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        'group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-start group-data-[collapsible=icon]:p-0!',
        logo ? 'justify-center' : 'h-12'
    )

    /** O desenho da marca, igual no link e no gatilho do seletor. */
    const MIOLO = (
        <>
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
        </>
    )

    /**
     * Com uma unidade só, a marca continua sendo um link para o início — que é
     * o que ela sempre foi, e o que vale para quase todo cliente. O seletor só
     * existe para quem tem o que selecionar: um menu de um item é um menu que
     * só ensina que não há escolha.
     */
    if (unidades.length > 1) {
        return (
            <DropdownMenu>
                <DropdownMenuTrigger
                    disabled={trocando}
                    aria-label={`Unidade atual: ${name ?? 'OdontoBox360'}. Trocar de unidade`}
                    className={cn(CLASSE_MARCA, 'relative')}
                >
                    {MIOLO}
                    <ChevronsUpDown className="absolute right-2 size-3.5 shrink-0 text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right" className="w-60">
                    <DropdownMenuLabel className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                        Unidades
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {unidades.map((u) => (
                        <DropdownMenuItem
                            key={u.id}
                            onClick={() => void trocar(u.id)}
                            className="gap-2"
                        >
                            <Check className={cn('size-4', u.id !== atual && 'opacity-0')} />
                            <span className="truncate">{u.name}</span>
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        )
    }

    // O link desenha a si mesmo, em vez de herdar de `SidebarMenuButton`: com
    // `asChild` o filho ficava sem classe nenhuma — nem padding, nem hover, nem
    // anel de foco —, e a marca era o único item do menu sem estado visível.
    return (
        <Link
            href="/dashboard"
            aria-label={logo ? (name ?? 'Início') : 'OdontoBox360'}
            className={CLASSE_MARCA}
        >
            {MIOLO}
        </Link>
    )
}
