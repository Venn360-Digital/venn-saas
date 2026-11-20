'use client'

import { useId, useState } from 'react'
import { Pipette } from 'lucide-react'

import { Input } from '@venn/ui/input'
import { cn } from '@venn/ui/utils'
import { PICKER_RAMP, tintaSobre } from '../../lib/palette'

/**
 * Uma cor qualquer: a rampa da marca, o seletor do sistema e o código à mão.
 *
 * ## Por que esta peça existe, e onde ela NÃO deve ser usada
 *
 * O projeto tem um escolhedor de cor anterior — o da fase do funil e da
 * etiqueta —, e ele oferece **só a rampa** (`PICKER_RAMP`, oito matizes). É
 * deliberado: aquelas cores são dado interno, pintam chip e coluna dentro do
 * sistema, e campo hex livre ali produz a etiqueta verde-limão sobre branco
 * que ninguém lê. Ver `DESIGN.md` §2, "Cores que vêm do banco".
 *
 * Aqui é o oposto: a cor do formulário de captura pinta uma página **do site
 * do cliente**, ao lado da marca dele. Limitar a oito matizes da nossa marca
 * seria impor a nossa identidade ao site dele. Pedido do Andre em 20/11/2026:
 * "o seletor de cor não deve ser apenas opções, deve ter um seletor completo
 * que o usuário navega e escolhe, aquele raio padrão de cores que permite
 * digitar o código".
 *
 * Então: a rampa continua, como atalho; ao lado dela, o seletor do sistema
 * (roda de cores, conta-gotas e campo próprio, tudo que o SO já sabe fazer) e
 * o código hex digitável.
 *
 * ## `input type="color"` nativo, e por quê
 *
 * É a única superfície que entrega roda de cores e conta-gotas sem biblioteca,
 * e ela é a **mesma** que a pessoa já conhece de qualquer outro programa. A
 * regra do DESIGN.md contra superfície nativa é sobre `<audio>` e `<video>`,
 * que mudam de forma e ignoram o tema no meio da página; este controle é um
 * campo de formulário, abre por cima e fecha. O que não se aceita dele é a
 * aparência padrão: o `appearance-none` e o recorte abaixo deixam o botão com
 * a forma dos outros controles da casa.
 */
export function SeletorDeCor({
    cor,
    onChange,
    disabled,
    /** Rótulo acessível — a cor de quê. */
    ariaLabel,
    className,
}: {
    cor: string
    onChange: (hex: string) => void
    disabled?: boolean
    ariaLabel: string
    className?: string
}) {
    const id = useId()
    /**
     * O texto do campo vive à parte da cor aplicada — e só enquanto se digita.
     *
     * Quem digita passa por `#ab`, `#abc`… — estados que não são cor nenhuma.
     * Aplicar a cada tecla pintaria a prévia de preto no meio da digitação;
     * então o campo guarda o rascunho e só o valor completo sobe.
     *
     * `null` quer dizer "mostre a cor aplicada". É o que faz o campo acompanhar
     * sozinho a cor escolhida por fora — na rampa, na roda do sistema, num
     * formulário recarregado — **sem um efeito que copie prop para estado**:
     * aquele efeito é o que o `react-hooks/set-state-in-effect` acusa, e com
     * razão, porque renderiza duas vezes para chegar ao mesmo lugar.
     */
    const [rascunho, setRascunho] = useState<string | null>(null)
    const noCampo = rascunho ?? cor

    const aplicar = (valor: string) => {
        const texto = valor.trim()
        const comCerquilha = texto.startsWith('#') ? texto : `#${texto}`
        setRascunho(comCerquilha)
        if (/^#[0-9a-fA-F]{6}$/.test(comCerquilha)) onChange(comCerquilha.toLowerCase())
    }

    return (
        <div className={cn('space-y-2', className)}>
            <div className="flex items-center gap-2">
                {/* O seletor do sistema, escondido atrás da própria amostra: o
                    clique na amostra abre a roda de cores. `sr-only` não serve
                    aqui — o input precisa de área clicável —, então ele cobre
                    a amostra com opacidade zero. */}
                <span className="relative inline-flex size-9 shrink-0">
                    <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 rounded-md border border-input"
                        style={{ backgroundColor: cor }}
                    />
                    {/* A tinta do ícone é calculada da cor escolhida
                        (`tintaSobre`), não fixa: sobre o gelo da marca um
                        ícone branco desaparece, e sobre o navy um escuro
                        também. Antes era a classe de branco literal com
                        `mix-blend-difference`, que resolvia os dois casos de
                        uma vez — mas branco literal é o que o `lint:colors`
                        proíbe fora da paleta, e com razão: a mesma classe em
                        outra tela é um token que ninguém procurou. (O linter
                        conta a ocorrência mesmo dentro de comentário, então
                        aqui ela está descrita, não escrita.) */}
                    <Pipette
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 m-auto size-4"
                        style={{ color: tintaSobre(cor) }}
                    />
                    <input
                        type="color"
                        id={id}
                        value={/^#[0-9a-fA-F]{6}$/.test(cor) ? cor : PICKER_RAMP[0]}
                        disabled={disabled}
                        aria-label={ariaLabel}
                        onChange={(e) => onChange(e.target.value.toLowerCase())}
                        className="size-9 cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed"
                    />
                </span>

                <Input
                    value={noCampo}
                    disabled={disabled}
                    onChange={(e) => aplicar(e.target.value)}
                    // Ao sair, o rascunho pela metade é descartado e o campo
                    // volta a mostrar a cor que de fato está aplicada.
                    onBlur={() => setRascunho(null)}
                    spellCheck={false}
                    maxLength={7}
                    aria-label={`${ariaLabel} em código hexadecimal`}
                    className="h-9 w-[7.5rem] font-mono text-xs uppercase"
                />
            </div>

            {/* A rampa da marca continua, como atalho para quem não tem uma cor
                em mente — e é o que dá uma escolha boa por padrão. */}
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${ariaLabel}: cores da marca`}>
                {PICKER_RAMP.map((hex) => (
                    <button
                        key={hex}
                        type="button"
                        role="radio"
                        aria-checked={cor.toLowerCase() === hex.toLowerCase()}
                        aria-label={hex}
                        disabled={disabled}
                        onClick={() => onChange(hex.toLowerCase())}
                        className={cn(
                            'size-5 rounded-full ring-offset-2 ring-offset-card disabled:cursor-not-allowed',
                            cor.toLowerCase() === hex.toLowerCase()
                                ? 'ring-2 ring-ring'
                                : 'hover:ring-2 hover:ring-border'
                        )}
                        style={{ backgroundColor: hex }}
                    />
                ))}
            </div>
        </div>
    )
}
