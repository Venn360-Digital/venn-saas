'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ChevronsUpDown, CreditCard, LogOut, Monitor, Moon, Settings, Sun, User } from 'lucide-react'
import { useTheme } from 'next-themes'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
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
 * The theme switch moved in here with it, as a three-way choice rather than a
 * toggle: "Sistema" is what most people actually want and a toggle cannot say.
 */
export function NavUser() {
    const { isMobile } = useSidebar()
    const router = useRouter()
    const { theme, setTheme } = useTheme()
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

    const signOut = async () => {
        const supabase = createClient()
        await supabase.auth.signOut()
        router.push('/login')
        router.refresh()
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
                            <DropdownMenuItem asChild>
                                <Link href="/gerenciamento/conta?tab=perfil">
                                    <User />
                                    Perfil
                                </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                                <Link href="/gerenciamento/conta?tab=plano">
                                    <CreditCard />
                                    Plano e créditos
                                </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                                <Link href="/gerenciamento/conta">
                                    <Settings />
                                    Configurações
                                </Link>
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                            Tema
                        </DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
                            <DropdownMenuRadioItem value="light">
                                <Sun className="mr-2 size-4" />
                                Claro
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="dark">
                                <Moon className="mr-2 size-4" />
                                Escuro
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="system">
                                <Monitor className="mr-2 size-4" />
                                Sistema
                            </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
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
