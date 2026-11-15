import {
  Bot,
  LayoutDashboard,
  Megaphone,
  Settings,
  Star,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import type { Vocabulario } from "./vocabulario";

/**
 * One source of truth for the route tree and for how a route is named in pt-BR.
 *
 * Breadcrumbs used to derive their labels by title-casing URL segments, which
 * rendered "/vendas/produtos-servicos" as "Produtos Servicos" — hyphen eaten,
 * accent gone (aquela rota hoje é `/vendas/servicos`).
 * The sidebar carried its own copy of the same names, so the two
 * could disagree. Both read from here now, and so does the trail in the
 * topbar.
 */

export interface NavItem {
  label: string;
  href: string;
  badge?: string;
  /**
   * Quem vê este item. Vazio ou ausente: todo perfil vê.
   *
   * Existe no item, e não só na seção, por causa de "Agentes de IA": ele sai
   * do menu do atendente, e a seção que o contém tem de ficar, porque é onde
   * mora Conversas — o trabalho dele.
   */
  allowedRoles?: string[];
  /**
   * A planned destination with no page behind it. Rendering it as a link
   * sends the user to a hard 404 — which is what Campanhas and Templates did.
   */
  disabled?: boolean;
}

export interface NavSection {
  label: string;
  icon: LucideIcon;
  /** Set for a section that is itself a destination, with no children. */
  href?: string;
  items?: NavItem[];
  /** Empty or absent means every role sees it. */
  allowedRoles?: string[];
}

/**
 * A navegação, com os rótulos do nicho resolvidos.
 *
 * Função e não constante porque os rótulos dependem da unidade: a mesma tela é
 * "Pacientes" numa clínica e "Clientes" num estúdio do mesmo ramo. Os SLUGS são
 * neutros e iguais nos três produtos desde 2026-11-11 — só o rótulo é do nicho.
 *
 * Quem chama no cliente passa `useVocab()`; no servidor, `vocab(settings)`.
 */
export function navSections(v: Vocabulario): NavSection[] {
  return [
    {
      label: "Dashboard",
      icon: LayoutDashboard,
      href: "/dashboard",
      allowedRoles: ["OWNER", "ADMIN", "GESTOR"],
    },
    {
      label: "Favoritos",
      icon: Star,
      items: [
        { label: "Conversas", href: "/atendimento/conversas" },
        { label: "Negócios", href: "/vendas/negocios" },
        { label: "Agenda", href: "/vendas/agenda" },
      ],
    },
    {
      label: "Atendimento e IA",
      icon: Bot,
      items: [
        {
          label: "Agentes de IA",
          href: "/atendimento/agentes",
          // Fora do menu do atendente, por decisão do Andre em 2026-10-14:
          // configurar agente não é trabalho dele, e o que ele precisa
          // saber da linha (no ar ou fora do ar, qual apelido) já está no
          // cabeçalho da conversa. O gestor continua vendo — e a tela é
          // somente leitura para ele, porque administrar agente é de dono
          // e administrador. Esconder menu não é permissão: quem recusa é
          // o servidor, em `src/lib/auth/agent.ts`.
          allowedRoles: ["OWNER", "ADMIN", "GESTOR"],
        },
        { label: "Conversas", href: "/atendimento/conversas" },
        { label: "Etiquetas", href: "/atendimento/etiquetas" },
        /**
         * **Departamento é de atendimento, não de CRM** — mudança de menu
         * pedida pelo Andre em 2026-11-09, logo depois de Etiquetas.
         *
         * Ele vivia em Vendas (CRM) por vizinhança com Especialistas e
         * Procedimentos — três cadastros de apoio —, mas o que um
         * departamento faz no produto é **recortar fila de conversa**: é
         * ele que a linha de WhatsApp aponta, ele que a ficha do usuário
         * marca, e é por ele que o atendente vê ou não vê uma conversa.
         * Quem vem configurar fila procurava em Atendimento e encontrava
         * Etiquetas e Respostas rápidas, nunca Departamentos.
         *
         * **A rota continua `/vendas/departamentos`.** O que mudou é onde
         * o menu o anuncia; mover o segmento invalidaria links guardados e
         * exigiria redirecionamento, por nenhum ganho — a trilha já lê o
         * rótulo de `SEGMENT_LABELS`, não da seção.
         */
        { label: "Departamentos", href: "/vendas/departamentos" },
        { label: "Respostas rápidas", href: "/atendimento/respostas-rapidas" },
      ],
    },
    {
      label: "Vendas (CRM)",
      icon: TrendingUp,
      items: [
        { label: "Negócios", href: "/vendas/negocios" },
        // Os segmentos de URL são neutros (`clientes`, `profissionais`,
        // `servicos`) e iguais nos três produtos — decisão de 2026-11-11,
        // preparando o código compartilhado. O nicho mora só no rótulo.
        { label: v.Pessoas, href: "/vendas/clientes" },
        { label: "Agenda", href: "/vendas/agenda" },
        { label: v.Profissionais, href: "/vendas/profissionais" },
        { label: v.Servicos, href: "/vendas/servicos" },
      ],
    },
    {
      label: "Marketing",
      icon: Megaphone,
      allowedRoles: ["OWNER", "ADMIN", "GESTOR"],
      items: [
        { label: "Campanhas", href: "/marketing/campanhas" },
        { label: "Listas de contatos", href: "/marketing/listas" },
        { label: "Templates", href: "/marketing/templates" },
        { label: "Domínios", href: "/marketing/remetentes" },
        { label: "Funis", href: "/marketing/funis" },
      ],
    },
  ];
}

/**
 * Segment to label. Sentence case throughout, per DESIGN.md — proper nouns and
 * acronyms keep their capitals.
 */
function segmentLabels(v: Vocabulario): Record<string, string> {
  return {
    dashboard: "Dashboard",

    atendimento: "Atendimento",
    conversas: "Conversas",
    agentes: "Agentes de IA",
    etiquetas: "Etiquetas",
    "respostas-rapidas": "Respostas rápidas",
    // A rota continua `comandos`; o nome que se lê é outro desde 2026-10-15.
    comandos: "Parametrização",
    gerenciamento: "Gerenciamento",
    integracoes: "Integrações",
    novo: "Novo",

    vendas: "Vendas",
    negocios: "Negócios",
    clientes: v.Pessoas,
    // Slugs anteriores da mesma tela: `contatos` até 2026-10-08, `pacientes`
    // até 2026-11-11 (quando o segmento ficou neutro entre os produtos). Os
    // rótulos ficam porque um link antigo que alguém guardou ainda passa pelo
    // redirecionamento, e a trilha não deve mostrar um slug cru no caminho.
    pacientes: v.Pessoas,
    contatos: v.Pessoas,
    agenda: "Agenda",
    profissionais: v.Profissionais,
    /*
     * Os SLUGS ANTIGOS ficam como estavam: `especialistas` e `procedimentos`
     * são endereços, não identificadores nossos.
     *
     * Um renomeio em massa de identificador os trocou por `profissionais` e
     * `servicos` e criou chave duplicada — o typecheck pegou. A lição é a
     * mesma das cinco formas de "literal que não é texto": slug de URL é
     * contrato com quem guardou o link, e a trilha não deve mostrar slug cru
     * quando o rewrite ainda resolve.
     */
    especialistas: v.Profissionais,
    servicos: v.Servicos,
    procedimentos: v.Servicos,
    departamentos: "Departamentos",

    suporte: "Dúvidas e suporte",
    conta: "Conta",
    usuarios: "Usuários",

    marketing: "Marketing",
    campanhas: "Campanhas",
    listas: "Listas de contatos",
    templates: "Templates",
    remetentes: "Domínios",
    descadastro: "Cancelar inscrição",

    onboarding: "Primeiros passos",
  };
}

/**
 * Falls back to a de-hyphenated, capitalised segment so an unmapped route still
 * reads as words rather than a slug — but anything shipped should be in the map,
 * because the fallback cannot restore accents.
 */
export function labelForSegment(segment: string, v: Vocabulario): string {
  const known = segmentLabels(v)[segment];
  if (known) return known;
  const spaced = segment.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface Crumb {
  label: string;
  href: string;
  /** The last crumb is where the user already is, so it is not a link. */
  isCurrent: boolean;
}

export function crumbsFor(pathname: string, v: Vocabulario): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  return segments.map((segment, i) => ({
    label: labelForSegment(segment, v),
    href: "/" + segments.slice(0, i + 1).join("/"),
    isCurrent: i === segments.length - 1,
  }));
}

/**
 * The deepest segment's label — what the browser tab shows.
 *
 * The tab is the one place a page still has to name itself in plain text: it is
 * how someone finds this window among fifteen, and it is what a bookmark keeps.
 */
export function pageTitleFor(
  pathname: string,
  v: Vocabulario,
  nomeDaMarca: string,
): string {
  const segments = pathname.split("/").filter(Boolean);
  /*
   * A raiz devolve o nome da MARCA, que vem de quem chama.
   *
   * Era o literal do primeiro app, e num segundo produto a aba diria o nome
   * errado — o lugar mais visível possível para isso aparecer, porque é como
   * alguém acha esta janela entre quinze.
   */
  if (segments.length === 0) return nomeDaMarca;
  return labelForSegment(segments[segments.length - 1], v);
}
