'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ChevronsUpDown, Hospital, LogOut, Plug, User, Users } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from '@/components/ui/sidebar'
import { createClient } from '@/lib/supabase/client'
import { esquecerUnidades } from '@/hooks/useUnidades'

interface Me {
    user: { id: string; email: string; name: string; avatar: string | null; initials: string }
    workspace: { id: string; name: string; slug: string } | null
}

/**
 * Who you are, at the foot of the sidebar.
 *
 * The account menu used to sit in the topbar, which left that bar carrying both
 * the page's context and the session's identity. In the inset layout the
 * sidebar owns the session — workspace at the top, person at the bottom — and
 * the topbar is free to be about the page you are on.
 *
 * The theme switch stays in the footer above, as three buttons: it is a setting
 * someone flips while looking at the screen, and a button you can see beats a
 * menu you have to open.
 */
export function NavUser() {
    const { isMobile } = useSidebar()
    const [me, setMe] = useState<Me | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        fetch('/api/auth/me')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled) return
                if (data) setMe(data)
                setLoading(false)
            })
            .catch(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [])

    /**
     * Sair recarrega a página inteira, de propósito.
     *
     * `router.push` era navegação de cliente: o módulo JS continuava vivo, com
     * o cache da conta anterior dentro, e o Router Cache do Next podia reusar o
     * RSC do layout — que desde a correção do primeiro paint carrega **dados do
     * usuário**. Foi assim que a conta de um cliente apareceu no cabeçalho de
     * outro, na mesma aba.
     *
     * `window.location.assign` joga fora os dois caches de uma vez: a aba
     * reinicia. Custa um recarregamento numa ação que acontece uma vez por dia.
     */
    const signOut = async () => {
        /**
         * O cookie da unidade sai **antes** da sessão.
         *
         * Ele é httpOnly, então quem apaga é o servidor — e o middleware recusa
         * rota de API sem sessão. Chamar depois do `signOut` seria pedir a
         * exclusão já deslogado e receber 401, deixando o cookie para trás
         * exatamente no caso em que ele atrapalha.
         */
        await fetch('/api/workspace/switch', { method: 'DELETE' }).catch(() => {})

        const supabase = createClient()
        await supabase.auth.signOut()

        esquecerUnidades()
        window.location.assign('/login')
    }

    if (loading) {
        return (
            <SidebarMenu>
                <SidebarMenuItem>
                    <div className="flex items-center gap-2 p-2">
                        <Skeleton className="size-8 shrink-0 rounded-lg" />
                        <div className="flex-1 space-y-1.5 group-data-[collapsible=icon]:hidden">
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="h-2.5 w-32" />
                        </div>
                    </div>
                </SidebarMenuItem>
            </SidebarMenu>
        )
    }

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                        >
                            <Avatar className="size-8 rounded-lg">
                                <AvatarImage src={me?.user.avatar ?? ''} alt={me?.user.name ?? ''} />
                                <AvatarFallback className="rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                                    {me?.user.initials || 'U'}
                                </AvatarFallback>
                            </Avatar>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-medium">{me?.user.name || 'Usuário'}</span>
                                <span className="truncate text-xs text-sidebar-foreground/70">
                                    {me?.user.email || ''}
                                </span>
                            </div>
                            <ChevronsUpDown className="ml-auto size-4" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-[--radix-dropdown-menu-trigger-width] min-w-60 rounded-lg"
                        side={isMobile ? 'bottom' : 'right'}
                        align="end"
                        sideOffset={4}
                    >
                        <DropdownMenuLabel className="p-0 font-normal">
                            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                                <Avatar className="size-8 rounded-lg">
                                    <AvatarImage src={me?.user.avatar ?? ''} alt={me?.user.name ?? ''} />
                                    <AvatarFallback className="rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                                        {me?.user.initials || 'U'}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-medium">{me?.user.name || 'Usuário'}</span>
                                    <span className="truncate text-xs text-muted-foreground">
                                        {me?.user.email || ''}
                                    </span>
                                </div>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            {/* A ordem é a da própria tela de Conta: quem é
                                você, quem é a equipe, qual é a clínica, o que
                                ela conecta. Cada ícone é o mesmo que a aba usa
                                lá dentro — dois glifos para o mesmo destino
                                custam mais que nenhum.

                                "Plano e créditos" saiu daqui em 2026-10-18, por
                                decisão do Andre, e no lugar entrou a Conta da
                                Clínica. Faz sentido: plano é coisa que se mexe
                                uma vez por ano, e os dados da clínica e das
                                unidades são o que se procura. O plano continua
                                a uma guia de distância, dentro da mesma tela. */}
                            <DropdownMenuItem asChild>
                                <Link href="/gerenciamento/conta?tab=perfil">
                                    <User />
                                    Perfil
                                </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                                <Link href="/gerenciamento/conta?tab=usuarios">
                                    <Users />
                                    Usuários
                                </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                                <Link href="/gerenciamento/conta?tab=empresa">
                                    <Hospital />
                                    Conta da clínica
                                </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                                <Link href="/gerenciamento/conta?tab=integracoes">
                                    <Plug />
                                    Integrações
                                </Link>
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={() => void signOut()}
                        >
                            <LogOut />
                            Sair
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    )
}
