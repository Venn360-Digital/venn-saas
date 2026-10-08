'use client'

import Link from 'next/link'
import * as React from 'react'
import { type LucideIcon } from 'lucide-react'

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
 * It earns its place by what it is *not*: these are destinations someone reaches
 * a few times a month, and mixing them into the daily navigation made every
 * section longer for no gain. Small buttons, no section label, below the fold of
 * attention rather than behind a menu.
 */
export function NavSecondary({
    items,
    ...props
}: {
    items: { title: string; url: string; icon: LucideIcon }[]
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
    return (
        <SidebarGroup {...props}>
            <SidebarGroupContent>
                <SidebarMenu>
                    {items.map((item) => (
                        <SidebarMenuItem key={item.title}>
                            <SidebarMenuButton asChild size="sm" tooltip={item.title}>
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
