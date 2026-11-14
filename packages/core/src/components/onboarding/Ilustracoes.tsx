/**
 * As cinco ilustrações do trilho do cadastro.
 *
 * **Desenhadas, não capturadas.** É a regra que o DESIGN.md fixou na Tela 05 e
 * que vale com mais força aqui: print envelhece na primeira mudança de layout e
 * ninguém lembra de trocar — um cadastro que mostra a tela de três versões atrás
 * é pior que um que não mostra nada. SVG em token de cor acompanha o tema e
 * sobrevive ao redesenho.
 *
 * Todas em 200×150, para o trilho não mudar de altura entre os passos — o
 * cartão é de tamanho fixo, e um desenho mais alto que o outro desfaria o
 * trabalho que o tamanho fixo faz.
 *
 * As cores saem de `currentColor` e das classes `text-*`, nunca de hexadecimal:
 * `scripts/lint-colors.mjs` recusa cor crua fora dos caminhos permitidos, e com
 * razão — o trilho é `primary-subtle`, que é quase branco no claro e azul
 * profundo no escuro.
 */

/** O quadro comum: mesma caixa, mesma moldura, em todos os cinco. */
function Quadro({ children }: { children: React.ReactNode }) {
    return (
        <svg
            viewBox="0 0 200 150"
            className="h-auto w-full max-w-[200px] text-primary-subtle-foreground"
            aria-hidden="true"
            focusable="false"
        >
            {children}
        </svg>
    )
}

/** Passo 1 — o nome virando endereço. */
export function IlustracaoWorkspace() {
    return (
        <Quadro>
            <rect
                x="18"
                y="26"
                width="164"
                height="98"
                rx="12"
                className="fill-card stroke-primary/40"
                strokeWidth="2"
            />
            <rect x="34" y="44" width="132" height="12" rx="6" className="fill-primary/25" />
            <rect x="34" y="66" width="92" height="9" rx="4.5" className="fill-border" />
            <rect x="34" y="84" width="112" height="9" rx="4.5" className="fill-border" />
            <rect x="34" y="102" width="56" height="9" rx="4.5" className="fill-primary/40" />
            <circle cx="156" cy="106" r="16" className="fill-primary" />
            <path
                d="M149 106.5l4.6 4.6L163 102"
                className="stroke-primary-foreground"
                strokeWidth="2.4"
                fill="none"
                strokeLinecap="round"
            />
        </Quadro>
    )
}

/** Passo 2 — três planos, e o do meio escolhido. */
export function IlustracaoPlano() {
    return (
        <Quadro>
            <rect
                x="16"
                y="60"
                width="46"
                height="62"
                rx="9"
                className="fill-card stroke-primary/30"
                strokeWidth="2"
            />
            <rect x="74" y="32" width="52" height="90" rx="9" className="fill-primary" />
            <rect
                x="138"
                y="70"
                width="46"
                height="52"
                rx="9"
                className="fill-card stroke-primary/30"
                strokeWidth="2"
            />
            <path
                d="M90 74l5.4 5.4L112 63"
                className="stroke-primary-foreground"
                strokeWidth="2.6"
                fill="none"
                strokeLinecap="round"
            />
            <rect x="26" y="76" width="26" height="6" rx="3" className="fill-border" />
            <rect x="26" y="90" width="18" height="6" rx="3" className="fill-border" />
            <rect x="148" y="86" width="26" height="6" rx="3" className="fill-border" />
        </Quadro>
    )
}

/** Passo 3 — o celular lendo o código. */
export function IlustracaoWhatsApp() {
    return (
        <Quadro>
            <rect
                x="20"
                y="24"
                width="74"
                height="102"
                rx="12"
                className="fill-card stroke-primary/40"
                strokeWidth="2"
            />
            <rect x="46" y="31" width="22" height="4" rx="2" className="fill-border" />
            <rect x="32" y="46" width="50" height="50" rx="6" className="fill-primary/15" />
            {/* Um código de leitura, insinuado: três cantos e um miolo. */}
            <rect x="38" y="52" width="12" height="12" rx="2" className="fill-primary" />
            <rect x="64" y="52" width="12" height="12" rx="2" className="fill-primary" />
            <rect x="38" y="78" width="12" height="12" rx="2" className="fill-primary" />
            <rect x="60" y="76" width="6" height="6" rx="1" className="fill-primary/60" />
            <rect x="70" y="84" width="6" height="6" rx="1" className="fill-primary/60" />
            <rect x="32" y="104" width="50" height="7" rx="3.5" className="fill-border" />

            <path
                d="M104 75h28"
                className="stroke-primary"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeDasharray="5 5"
            />
            <circle cx="158" cy="75" r="22" className="fill-primary/15" />
            <path
                d="M149 75.5l5.6 5.6L168 68"
                className="stroke-primary-subtle-foreground"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Quadro>
    )
}

/** Passo 4 — o agente, e a conversa que ele atende. */
export function IlustracaoAgente() {
    return (
        <Quadro>
            <circle cx="52" cy="58" r="22" className="fill-primary" />
            <circle cx="52" cy="52" r="8" className="fill-primary-foreground" />
            <path
                d="M38 74c3-7 8-10 14-10s11 3 14 10"
                className="fill-primary-foreground"
            />
            <rect
                x="92"
                y="34"
                width="92"
                height="30"
                rx="12"
                className="fill-card stroke-primary/30"
                strokeWidth="2"
            />
            <rect x="104" y="46" width="48" height="6" rx="3" className="fill-border" />
            <rect x="60" y="82" width="92" height="30" rx="12" className="fill-primary/15" />
            <rect x="72" y="94" width="58" height="6" rx="3" className="fill-primary/50" />
            <rect x="16" y="94" width="30" height="6" rx="3" className="fill-border" />
        </Quadro>
    )
}

/** Passo 5 — o documento assinado. */
export function IlustracaoTermos() {
    return (
        <Quadro>
            <rect
                x="46"
                y="20"
                width="108"
                height="112"
                rx="10"
                className="fill-card stroke-primary/40"
                strokeWidth="2"
            />
            <rect x="62" y="38" width="60" height="8" rx="4" className="fill-primary/30" />
            <rect x="62" y="56" width="76" height="6" rx="3" className="fill-border" />
            <rect x="62" y="70" width="68" height="6" rx="3" className="fill-border" />
            <rect x="62" y="84" width="76" height="6" rx="3" className="fill-border" />
            <circle cx="130" cy="112" r="16" className="fill-primary" />
            <path
                d="M123 112.5l4.6 4.6L137 108"
                className="stroke-primary-foreground"
                strokeWidth="2.4"
                fill="none"
                strokeLinecap="round"
            />
        </Quadro>
    )
}
