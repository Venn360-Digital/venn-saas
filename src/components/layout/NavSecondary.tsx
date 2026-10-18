'use client'

import Link from 'next/link'
import * as React from 'react'
import { type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import {
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar'

/**
 * The group the sidebar-08 block pins to the bottom with `mt-auto`.
 *
 * It earns its place by what it is *not*: a destination someone reaches a few
 * times a month, which would make every daily section longer for no gain if it
 * sat among them — and which should not be hidden behind a menu either. Small
 * buttons, no section label, below the fold of attention.
 */
export function NavSecondary({
    items,
    ...props
}: {
    items: {
        title: string
        url: string
        icon: LucideIcon
        /**
         * O item que se procura quando algo deu errado.
         *
         * Ganha fundo e cor de marca porque é achado sob estresse: quem vem
         * aqui já tentou resolver sozinho, e varrer uma coluna de itens
         * cinzentos iguais é exatamente o que não ajuda nessa hora. Um só por
         * sidebar — dois destaques não destacam nada.
         */
        destaque?: boolean
    }[]
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
    return (
        <SidebarGroup {...props}>
            <SidebarGroupContent>
                <SidebarMenu>
                    {items.map((item) => (
                        <SidebarMenuItem key={item.title}>
                            <SidebarMenuButton
                                asChild
                                size="sm"
                                tooltip={item.title}
                                className={cn(
                                    item.destaque &&
                                        'bg-primary-subtle text-primary-subtle-foreground font-semibold hover:bg-primary-subtle hover:text-primary-subtle-foreground'
                                )}
                            >
                                <Link href={item.url}>
                                    <item.icon />
                                    <span>{item.title}</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    ))}
                </SidebarMenu>
            </SidebarGroupContent>
        </SidebarGroup>
    )
}
