'use client'

import { useTheme } from 'next-themes'
import { Check, Monitor, Moon, Sun } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMounted } from '@/hooks/useMounted'

const OPTIONS = [
    { value: 'light', label: 'Claro', icon: Sun },
    { value: 'dark', label: 'Escuro', icon: Moon },
    // `enableSystem` já estava ligado no provider mas era inalcançável pela
    // tela, então quem tem o sistema no escuro não tinha como dizer isso.
    { value: 'system', label: 'Sistema', icon: Monitor },
] as const

/**
 * Um botão só, que abre as três opções.
 *
 * ## Por que compactou
 *
 * Eram três botões sempre à vista, numa pílula de ~96px. Ficou apertado quando
 * o cabeçalho ganhou o gatilho da equipe, em 2026-11-05 — e foi ele quem
 * mandou compactar, pela razão certa: trocar de tema é coisa que se faz uma vez
 * por mês, e estava ocupando mais barra que a clínica em que a pessoa está.
 * Agora o botão mostra **o tema em uso** e só desdobra quando clicado.
 *
 * ## O brilho
 *
 * Ele pediu o ícone com mais destaque, e o destaque aqui é **contraste, não
 * cor**: `text-foreground` sobre `bg-muted`, em vez do `text-muted-foreground`
 * sem fundo dos ícones vizinhos. Cor de marca não entra — o DESIGN.md (§6)
 * reserva o único texto colorido do cabeçalho para "em que clínica estou", e um
 * segundo ponto ciano ali tiraria desse o que ele tem.
 *
 * Antes de montar, o tema guardado é desconhecido: sai o ícone do sistema, que
 * é o padrão do provider. Marcar um dos três antes de saber mostraria a opção
 * errada e depois se corrigiria à vista.
 */
export function ThemeToggle() {
    const { theme, setTheme } = useTheme()
    const mounted = useMounted()

    const atual = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2]
    const Icone = mounted ? atual.icon : Monitor

    return (
        <DropdownMenu>
            <Tooltip>
                <TooltipTrigger asChild>
                    <DropdownMenuTrigger
                        className={cn(
                            'flex size-8 items-center justify-center rounded-lg bg-muted text-foreground transition-colors',
                            'hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
                        )}
                        aria-label={mounted ? `Tema: ${atual.label}` : 'Tema'}
                    >
                        <Icone className="size-4" />
                    </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Tema</TooltipContent>
            </Tooltip>

            <DropdownMenuContent align="end" className="w-40">
                {OPTIONS.map(({ value, label, icon: Icon }) => (
                    <DropdownMenuItem
                        key={value}
                        onSelect={() => setTheme(value)}
                        className="gap-2"
                    >
                        <Icon className="size-4 text-muted-foreground" />
                        {label}
                        {mounted && theme === value ? (
                            <Check className="ml-auto size-4 text-primary-subtle-foreground" />
                        ) : null}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
