# Design tokens

Capturado no Dashboard, **tema dark**, trial Growth. Evidência: [obs EV-003] (tokens.js, 567 variáveis CSS). Tema light ainda não capturado (há alternância de tema — ver "Não testado").

## Sistema
- **Design system próprio "DLS"** — prefixo `--dls-*` — por cima de **Vuetify** (`--v-*`) e **Tailwind** (`--tw-*`). O clone deve reproduzir uma camada de tokens semântica equivalente (`--dls-color-*`, `--dls-spacing-*`, `--dls-radius-*`, `--dls-font-*`).
- Raiz dark: `html.dark` (sem `data-theme`; alterna por classe). [obs EV-003]

## Tipografia
- **Família primária:** `Inter, sans-serif` (74 ocorrências). Secundária/legada: `Helvetica, Arial, sans-serif`.
- **Fallback (DLS):** `--dls-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif, emoji`. Mono: `--dls-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ...`.
- **Pesos:** `--dls-font-weight-normal:400`, `-medium:500`, `-semibold:600`, `-bold:700`.
- **Escala (font-size/line-height weight — frequência):** 12/20·400, 14/20·600, 16/20·600, 14/20·400, 14/16·500, 14/22·600, 11/20·400, 24/32·700, 16/28·500, 34/40·400, 20/24·700. Ícones via fonte `iconfont`.

## Cores (paleta DLS) → CSS variables
| Papel | Token DLS | Valor |
|---|---|---|
| Primária (azul) | `--dls-color-blue-base` | rgb(66,135,255) `#4287ff` |
| Primária clara | `--dls-color-blue-lighten-1` | rgb(107,164,255) `#6ba4ff` |
| Azul lighten/darken | `--dls-color-blue-lighten-3/4`, `-darken-5` | `#bdd6ff` · `#e6efff` · `#2c3a58` |
| **IA (marca Respond AI)** | `--dls-color-respond-ai-base` | rgb(115,112,255) `#7370ff` (+ lighten-3 `#d2d1ff`, darken-2/3) |
| Sucesso | `--dls-color-green-base` | rgb(51,199,88) `#33c758` |
| Erro | `--dls-color-red-base` | rgb(255,56,46) `#ff382e` |
| Aviso | `--dls-color-orange-base` / `--dls-color-yellow-base` | `#fa8900` · `#ffcc00` |
| Roxo | `--dls-color-purple-base` | `#b054de` (darken-1 `#a031d8`) |
| Neutras | `--dls-color-neutral-base/white/black` | rgb(237,237,238) · `#fff` · `#000` |
| Cinzas | `--dls-color-grey-base/lighten-1/lighten-3/darken-2` | 143 · 164 · 206 · 102 (tons) |
| Fundo (dark) | `--dls-color-bg-navigation-drawer` / `-bg-neutral` | rgb(16,17,19) `#101113` |
| Avatar | `--dls-color-bg-avatar` | rgb(0,73,199) |

**Mais usadas no dashboard (dark):** texto rgb(207,211,216) e rgb(151,160,170); branco; borda rgba(182,188,195,0.16); azul `#6ba4ff`/`#4287ff`; fundo `#101113`; verde rgb(81,210,113).

## Espaçamento (`--dls-spacing-*`, px)
Escala: 0·2·4·6·8·10·12·14·16·20·24·28·32·36·40·44·48·52·56·64. **Mais usados:** 16, 12, 4, 8, 2.
Ícones (`--dls-spacing-icon-*`): xxs10·xs16·sm18·md20·lg22·xl24·xxl48·3xl62.

## Raio (`--dls-radius-*`)
- rectangular-4 = 4px · rectangular-8 / modal / alert / button = **8px** (padrão) · rounded (pill) = **128px** · zero = 0.
- Mais usados: 8px (botões/cards), 128px (pills/avatars).

## Sombra
Elevação estilo Material: `rgba(0,0,0,.2) 0 0 0 0, rgba(0,0,0,.14) ..., rgba(0,0,0,.12) ...` em camadas (sutil).

## Movimento
- **Duração padrão:** `--dls-default-transition-duration: .15s`. Ease-out: `--dls-ease-out: cubic-bezier(0,0,.2,1)`. Easing padrão Material: `cubic-bezier(0.4,0,0.2,1)`.
- Comuns: `transition color/bg/border .15s`, `transition all .15s ease`, `transition all .2s cubic-bezier(.4,0,.2,1)`.
- Progresso indeterminado: animação 2.2s ease.

## z-index (app)
0, 10 (camadas base); overlays 9998/9999. (Valores 2147483644/646 observados são da extensão do navegador, não do app.)

## Não testado
- **Tema light** (tokens.js só rodou no dark) — rodar no modo claro e mapear os overrides.
- Tokens por componente específico (botões, inputs, chips) via `tokens.element()`.
- Breakpoints responsivos (checar em 1440/1024/390).
