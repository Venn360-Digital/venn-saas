'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, Circle, Hospital, LogOut, Plug, User, Users } from 'lucide-react'

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
import { DISPONIBILIDADE } from '@/components/shared/StatusBadge'
import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from '@/components/ui/sidebar'
import { signOut as encerrarSessao } from '@/lib/auth/cliente'
import { esquecerUnidades } from '@/hooks/useUnidades'

interface Me {
    user: { id: string; email: string; name: string; avatar: string | null; initials: string }
    workspace: { id: string; name: string; slug: string } | null
    /** O estado **já com a escada aplicada** — o mesmo que o sistema usa. */
    disponibilidade?: string | null
    /** Sem isto o seletor não aparece: quem não recebe não tem o que marcar. */
    recebeConversas?: boolean
}

/**
 * Os três estados, na ordem em que se usa: chego, saio para algo, vou embora.
 *
 * **Verde recebe; amarelo e cinza não** — e os dois últimos são iguais para a
 * distribuição. A diferença existe para a equipe saber se vale chamar no
 * particular, e a dica de cada item diz isso, porque quem lê "ocupado" supõe
 * que recebe *menos* quando recebe *nada*.
 */
/**
 * O que a bolinha mostra. **A mesma conta do servidor**, para a tela e o
 * sistema nunca divergirem — foi esse descompasso o defeito da primeira versão.
 *
 * O limite vem do servidor junto com o status; sem ele, a bolinha mentiria para
 * a conta que configurou outro tempo.
 */
const ESTADOS = [
    { id: 'disponivel', rotulo: 'Disponível', cor: 'text-success', dica: 'Recebe conversas novas' },
    { id: 'ocupado', rotulo: 'Ocupado', cor: 'text-destructive', dica: 'Está aqui, mas não recebe' },
    { id: 'ausente', rotulo: 'Ausente', cor: 'text-warning', dica: 'Não recebe' },
] as const

/** Inclui o cinza, que ninguém escolhe — ele vem da escada ou do logout. */
const COR_DO_ESTADO: Record<string, string> = {
    disponivel: 'text-success',
    ocupado: 'text-destructive',
    ausente: 'text-warning',
    desconectado: 'text-muted-foreground',
}

/**
 * A bolinha sobre o avatar, sempre à vista.
 *
 * **É o que faz a escada ser honesta.** Derivar o estado e não mostrá-lo foi o
 * defeito da primeira versão: o badge dizia "Disponível" e o sistema já não
 * entregava nada, e ninguém tinha como descobrir. Com a bolinha, quem ficou
 * amarelo por uma hora parado vê, e um clique devolve ao verde.
 *
 * `ring` da cor do fundo e não borda: a bolinha encosta no avatar, e sem o anel
 * ela some sobre uma foto escura.
 */
function Bolinha({ estado }: { estado: string }) {
    const info = DISPONIBILIDADE[estado]
    return (
        <span
            aria-label={info?.label ?? estado}
            title={info?.label ?? estado}
            className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-sidebar ${COR_DO_ESTADO[estado] ?? 'text-muted-foreground'}`}
        >
            <Circle className="size-full fill-current stroke-0" />
        </span>
    )
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
    /**
     * O status mora em estado local para a marca mudar no clique.
     *
     * Esperar a resposta da rota para pintar o visto deixaria o menu parecendo
     * travado — e o efeito real é só quem recebe a próxima conversa, não algo
     * que o usuário precise ver confirmado antes de seguir.
     */
    const [disponibilidade, setDisponibilidade] = useState<string | null>(null)

    const mudarStatus = async (status: string) => {
        setDisponibilidade(status)
        await fetch('/api/me/disponibilidade', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        }).catch(() => { /* o próximo carregamento corrige */ })
    }

    useEffect(() => {
        let cancelled = false
        fetch('/api/auth/me')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled) return
                if (data) {
                    setMe(data)
                    setDisponibilidade(data.disponibilidade ?? null)
                }
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

        /**
         * Sair apaga a bolinha verde. Antes do `signOut` pelo mesmo motivo da
         * linha acima: depois dele o pedido chega sem sessão e toma 401,
         * deixando a pessoa verde no painel de quem ficou.
         *
         * É isto que faz "logar já vem disponível" funcionar: quem está
         * `desconectado` volta ao verde no primeiro pedido autenticado (ver
         * `getWorkspaceMember`).
         */
        await fetch('/api/me/disponibilidade', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'desconectado' }),
        }).catch(() => {})

        await encerrarSessao()

        esquecerUnidades()
        window.location.assign('/login')
    }

    /**
     * **A moldura é real; o conteúdo não se inventa.** Conserto de 2026-11-09.
     *
     * Aqui eram três `Skeleton` — o quadrado do retrato e duas barras de texto
     * — e esta é a ocorrência que mais aparecia da "sombra de campos" que o
     * Andre apontou três vezes: o rodapé da barra lateral é desenhado em
     * **toda** tela do sistema, então a sombra piscava a cada navegação que
     * remonta o shell, não só nas duas telas que ele nomeou.
     *
     * Fica a linha com a altura que ela terá — `size-8` de retrato mais o
     * `p-2` —, e vazia. Reservar o espaço importa: devolver `null` faria o
     * rodapé nascer sem altura e empurrar a barra quando o nome chegasse, e
     * salto de layout é a outra forma do mesmo incômodo. O que não se desenha é
     * o que não se sabe — nome, e-mail e retrato.
     *
     * Sem limiar aqui, de propósito: não há o que mostrar depois dele. O limiar
     * (`useEsperaLonga`) serve para adiar um **sinal**; onde o estado de espera
     * já é o vazio, ele não tem função.
     */
    if (loading) {
        return (
            <SidebarMenu>
                <SidebarMenuItem>
                    <div aria-hidden="true" className="flex items-center gap-2 p-2">
                        <span className="size-8 shrink-0" />
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
                            {/* `relative` para a bolinha se pendurar no canto.
                                Ela fica no gatilho E no cabeçalho do menu: no
                                gatilho é onde se vê sem clicar, que era o
                                pedido; no cabeçalho é onde se confere depois de
                                mudar. */}
                            <span className="relative shrink-0">
                            <Avatar className="size-8 rounded-lg">
                                <AvatarImage src={me?.user.avatar ?? ''} alt={me?.user.name ?? ''} />
                                <AvatarFallback className="rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                                    {me?.user.initials || 'U'}
                                </AvatarFallback>
                            </Avatar>
                            {me?.recebeConversas && disponibilidade ? <Bolinha estado={disponibilidade} /> : null}
                            </span>
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

                        {/* ─── Disponibilidade ──────────────────────────────
                            No topo porque é o item que se usa várias vezes ao
                            dia — os destinos abaixo se visitam uma vez por mês.

                            Só aparece para quem entra na distribuição: marcar
                            "disponível" sem receber conversa não quer dizer
                            nada, e um controle que não faz efeito ensina a
                            ignorar os outros. ─────────────────────────────── */}
                        {me?.recebeConversas ? (
                            <>
                                <DropdownMenuGroup>
                                    {ESTADOS.map((e) => (
                                        <DropdownMenuItem
                                            key={e.id}
                                            onSelect={() => void mudarStatus(e.id)}
                                        >
                                            <Circle className={`size-2.5 fill-current ${e.cor}`} />
                                            <span className="flex-1">{e.rotulo}</span>
                                            <span className="text-xs text-muted-foreground">{e.dica}</span>
                                            {disponibilidade === e.id ? <Check className="size-4" /> : null}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                            </>
                        ) : null}

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
