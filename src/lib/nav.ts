import {
    Bot,
    LayoutDashboard,
    Megaphone,
    Settings,
    Star,
    TrendingUp,
    type LucideIcon,
} from 'lucide-react'

/**
 * One source of truth for the route tree and for how a route is named in pt-BR.
 *
 * Breadcrumbs used to derive their labels by title-casing URL segments, which
 * rendered "/vendas/produtos-servicos" as "Produtos Servicos" — hyphen eaten,
 * accent gone. The sidebar carried its own copy of the same names, so the two
 * could disagree. Both read from here now, and so does the trail in the
 * topbar.
 */

export interface NavItem {
    label: string
    href: string
    badge?: string
    /**
     * Quem vê este item. Vazio ou ausente: todo perfil vê.
     *
     * Existe no item, e não só na seção, por causa de "Agentes de IA": ele sai
     * do menu do atendente, e a seção que o contém tem de ficar, porque é onde
     * mora Conversas — o trabalho dele.
     */
    allowedRoles?: string[]
    /**
     * A planned destination with no page behind it. Rendering it as a link
     * sends the user to a hard 404 — which is what Campanhas and Templates did.
     */
    disabled?: boolean
}

export interface NavSection {
    label: string
    icon: LucideIcon
    /** Set for a section that is itself a destination, with no children. */
    href?: string
    items?: NavItem[]
    /** Empty or absent means every role sees it. */
    allowedRoles?: string[]
}

export const navSections: NavSection[] = [
    {
        label: 'Dashboard',
        icon: LayoutDashboard,
        href: '/dashboard',
        allowedRoles: ['OWNER', 'ADMIN', 'GESTOR'],
    },
    {
        label: 'Favoritos',
        icon: Star,
        items: [
            { label: 'Conversas', href: '/atendimento/conversas' },
            { label: 'Negócios', href: '/vendas/negocios' },
            { label: 'Agenda', href: '/vendas/agenda' },
        ],
    },
    {
        label: 'Atendimento e IA',
        icon: Bot,
        items: [
            {
                label: 'Agentes de IA',
                href: '/atendimento/agentes',
                // Fora do menu do atendente, por decisão do Andre em 2026-10-14:
                // configurar agente não é trabalho dele, e o que ele precisa
                // saber da linha (no ar ou fora do ar, qual apelido) já está no
                // cabeçalho da conversa. O gestor continua vendo — e a tela é
                // somente leitura para ele, porque administrar agente é de dono
                // e administrador. Esconder menu não é permissão: quem recusa é
                // o servidor, em `src/lib/auth/agent.ts`.
                allowedRoles: ['OWNER', 'ADMIN', 'GESTOR'],
            },
            { label: 'Conversas', href: '/atendimento/conversas' },
            { label: 'Etiquetas', href: '/atendimento/etiquetas' },
            { label: 'Respostas rápidas', href: '/atendimento/respostas-rapidas' },
        ],
    },
    {
        label: 'Vendas (CRM)',
        icon: TrendingUp,
        items: [
            { label: 'Negócios', href: '/vendas/negocios' },
            { label: 'Pacientes', href: '/vendas/pacientes' },
            { label: 'Agenda', href: '/vendas/agenda' },
            { label: 'Especialistas', href: '/vendas/especialistas' },
            { label: 'Produtos e serviços', href: '/vendas/produtos-servicos' },
            { label: 'Departamentos', href: '/vendas/departamentos' },
        ],
    },
    {
        label: 'Marketing',
        icon: Megaphone,
        allowedRoles: ['OWNER', 'ADMIN', 'GESTOR'],
        items: [
            {
                label: 'Campanhas',
                href: '/marketing/campanhas',
                badge: 'Em breve',
                disabled: true,
            },
            {
                label: 'Templates',
                href: '/marketing/templates',
                badge: 'Em breve',
                disabled: true,
            },
        ],
    },
]

/**
 * Segment to label. Sentence case throughout, per DESIGN.md — proper nouns and
 * acronyms keep their capitals.
 */
const SEGMENT_LABELS: Record<string, string> = {
    dashboard: 'Dashboard',

    atendimento: 'Atendimento',
    conversas: 'Conversas',
    agentes: 'Agentes de IA',
    etiquetas: 'Etiquetas',
    'respostas-rapidas': 'Respostas rápidas',
    // A rota continua `comandos`; o nome que se lê é outro desde 2026-10-15.
    comandos: 'Parametrização',
    gerenciamento: 'Gerenciamento',
    integracoes: 'Integrações',
    novo: 'Novo',

    vendas: 'Vendas',
    negocios: 'Negócios',
    pacientes: 'Pacientes',
    // A rota foi `contatos` até 2026-10-08. O rótulo fica porque um link antigo
    // que alguém guardou ainda passa pelo redirecionamento, e a trilha não deve
    // mostrar um slug cru no caminho.
    contatos: 'Pacientes',
    agenda: 'Agenda',
    especialistas: 'Especialistas',
    'produtos-servicos': 'Produtos e serviços',
    departamentos: 'Departamentos',

    conta: 'Conta',
    usuarios: 'Usuários',

    marketing: 'Marketing',
    campanhas: 'Campanhas',
    templates: 'Templates',

    onboarding: 'Primeiros passos',
}

/**
 * Falls back to a de-hyphenated, capitalised segment so an unmapped route still
 * reads as words rather than a slug — but anything shipped should be in the map,
 * because the fallback cannot restore accents.
 */
export function labelForSegment(segment: string): string {
    const known = SEGMENT_LABELS[segment]
    if (known) return known
    const spaced = segment.replace(/-/g, ' ')
    return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export interface Crumb {
    label: string
    href: string
    /** The last crumb is where the user already is, so it is not a link. */
    isCurrent: boolean
}

export function crumbsFor(pathname: string): Crumb[] {
    const segments = pathname.split('/').filter(Boolean)
    return segments.map((segment, i) => ({
        label: labelForSegment(segment),
        href: '/' + segments.slice(0, i + 1).join('/'),
        isCurrent: i === segments.length - 1,
    }))
}

/**
 * The deepest segment's label — what the browser tab shows.
 *
 * The tab is the one place a page still has to name itself in plain text: it is
 * how someone finds this window among fifteen, and it is what a bookmark keeps.
 */
export function pageTitleFor(pathname: string): string {
    const segments = pathname.split('/').filter(Boolean)
    if (segments.length === 0) return 'OdontoBox360'
    return labelForSegment(segments[segments.length - 1])
}
