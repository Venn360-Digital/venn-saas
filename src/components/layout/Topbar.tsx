'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, LogOut, User, Settings, Building2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createClient } from '@/lib/supabase/client'

interface UserData {
    user: {
        id: string
        email: string
        name: string
        avatar: string | null
        initials: string
    }
    workspace: {
        id: string
        name: string
        slug: string
    } | null
    role: string | null
}

export function Topbar() {
    const [userData, setUserData] = useState<UserData | null>(null)
    const [loading, setLoading] = useState(true)
    const router = useRouter()

    useEffect(() => {
        loadUserData()
    }, [])

    const loadUserData = async () => {
        try {
            const res = await fetch('/api/auth/me')
            if (res.ok) {
                const data = await res.json()
                setUserData(data)
            }
        } catch (error) {
            console.error('Error loading user data:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleLogout = async () => {
        const supabase = createClient()
        await supabase.auth.signOut()
        router.push('/login')
        router.refresh()
    }

    return (
        <div className="flex h-14 items-center justify-end border-b border-border bg-background px-6">

            {/* Actions */}
            <div className="flex items-center gap-3">
                {/* Notifications */}
                <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
                    <Bell className="h-5 w-5" />
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />
                </Button>

                {/* User Menu */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="gap-2 px-2">
                            <Avatar className="h-8 w-8 border border-border">
                                <AvatarImage src={userData?.user.avatar || ''} />
                                <AvatarFallback className="bg-primary/10 text-primary text-sm">
                                    {loading ? '...' : userData?.user.initials || 'U'}
                                </AvatarFallback>
                            </Avatar>
                            <div className="hidden flex-col items-start md:flex">
                                <span className="text-sm font-medium text-foreground">
                                    {loading ? 'Carregando...' : userData?.user.name || 'Usuário'}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {loading ? '' : userData?.workspace?.name || 'Sem workspace'}
                                </span>
                            </div>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                            {userData?.user.email}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem>
                            <User className="mr-2 h-4 w-4" />
                            Perfil
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                            <Settings className="mr-2 h-4 w-4" />
                            Configurações
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                            <Building2 className="mr-2 h-4 w-4" />
                            Trocar Workspace
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={handleLogout}
                        >
                            <LogOut className="mr-2 h-4 w-4" />
                            Sair
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    )
}
