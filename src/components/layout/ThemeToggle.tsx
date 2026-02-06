'use client'

import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'

export function ThemeToggle() {
    const { theme, setTheme } = useTheme()
    const [mounted, setMounted] = useState(false)

    // Prevent hydration mismatch
    useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) {
        return (
            <div className="flex items-center rounded-full bg-muted p-1">
                <div className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    <Sun className="h-3.5 w-3.5" />
                    <span>DAY</span>
                </div>
                <div className="flex items-center gap-1 rounded-full bg-background px-3 py-1.5 text-xs font-medium shadow-sm">
                    <Moon className="h-3.5 w-3.5" />
                    <span>NIGHT</span>
                </div>
            </div>
        )
    }

    return (
        <div className="flex items-center rounded-full bg-muted p-1">
            <button
                onClick={() => setTheme('light')}
                className={cn(
                    'flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200',
                    theme === 'light'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                )}
            >
                <Sun className="h-3.5 w-3.5" />
                <span>DAY</span>
            </button>
            <button
                onClick={() => setTheme('dark')}
                className={cn(
                    'flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200',
                    theme === 'dark'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                )}
            >
                <Moon className="h-3.5 w-3.5" />
                <span>NIGHT</span>
            </button>
        </div>
    )
}
