/**
 * The brand palette as literal hex, for the places a token cannot reach.
 *
 * Three of them, and only three: a value **stored in the database** (a stage's
 * colour, a tag's, an agent's), a **colour picker's** options, and **e-mail**,
 * where CSS variables do not exist. Everywhere else a colour is a token — see
 * `DESIGN.md` §2 — and `lint:colors` enforces that.
 *
 * This file exists so the exception is declared once instead of argued for at
 * each call site, the same reason `brand-colors.ts` exists for other companies'
 * colours. It is allowlisted in the linter; nothing else should be.
 */

export const BRAND_HEX = {
    navy: '#0b1f3b',
    navySoft: '#184f7c',
    teal: '#06b6d4',
    tealDeep: '#0e7490',
    sky: '#7dd3e8',
    ice: '#e6f7f5',
    mint: '#13b57e',
    mintDeep: '#065f46',
    amber: '#b45309',
    red: '#c62828',
    slate: '#53707f',
    white: '#ffffff',
} as const

/**
 * The options a user picks from for a stage or a tag.
 *
 * Eight hues, all from the brand, kept far enough apart to tell eight tags apart
 * at a glance. The ramp this replaced ran indigo → violet → purple → fuchsia:
 * the Kaly identity, seeded into every new workspace's funnel long after the
 * product stopped being Kaly.
 *
 * Changing it affects **new** rows only. A colour a clinic already chose keeps
 * rendering as chosen — rewriting a customer's data to match our taste would be
 * worse than an old default.
 */
export const PICKER_RAMP: readonly string[] = [
    BRAND_HEX.teal,
    BRAND_HEX.sky,
    BRAND_HEX.navySoft,
    BRAND_HEX.navy,
    BRAND_HEX.mint,
    BRAND_HEX.mintDeep,
    BRAND_HEX.amber,
    BRAND_HEX.red,
]

/** When nothing was chosen: a neutral that reads on white and on navy. */
export const DEFAULT_ENTITY_COLOR = BRAND_HEX.slate

/**
 * As etapas com que o funil de um workspace novo nasce.
 *
 * Desde a fusão, etapa e fase da jornada são a mesma coisa: estes nomes são o
 * que a clínica vê no painel do paciente, não só rótulos de coluna. Os
 * anteriores — "Aguardando atendimento, Atendendo agora, Pensando na proposta,
 * Vamos falar depois" — descreviam o estado do atendimento, não o percurso do
 * paciente, e a primeira clínica os renomeou à mão para exatamente estes.
 *
 * Vale só para funis novos: etapa que uma clínica já criou é escolha dela.
 */
export const DEFAULT_PIPELINE_STAGES = [
    { name: 'Em atendimento', color: BRAND_HEX.sky, order: 1 },
    { name: 'Agendamento', color: BRAND_HEX.teal, order: 2 },
    { name: 'Comparecimento', color: BRAND_HEX.mint, order: 3 },
    { name: 'Retrabalho', color: BRAND_HEX.amber, order: 4 },
] as const

/**
 * A tinta que vai **por cima** da cor escolhida para o widget.
 *
 * O widget deixou de ter cor fixa: a clínica escolhe, e um amarelo ou um
 * verde-água deixam o branco ilegível. `widget.js` decide entre as duas pela
 * luminância relativa do WCAG, e a tela de configuração repete a mesma conta
 * para a prévia não mentir. Os dois valores moram aqui porque é daqui que sai
 * todo hex literal do produto — e porque "escolha sua cor" sem isto seria
 * "escolha sua cor, e torça".
 */
export const TINTA_DO_WIDGET = {
    sobreClaro: BRAND_HEX.navy,
    sobreEscuro: '#ffffff',
} as const

/** Defaults for the agent's web chat widget, which the clinic can restyle. */
export const AGENT_WIDGET_DEFAULTS = {
    primaryColor: BRAND_HEX.teal,
    userMessageColor: BRAND_HEX.ice,
    userFontColor: BRAND_HEX.navy,
    agentMessageColor: BRAND_HEX.teal,
    agentFontColor: BRAND_HEX.navy,
} as const
