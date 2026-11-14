'use client'

/**
 * Deixa um formulário inteiro só de leitura, sem tocar campo por campo.
 *
 * Esconder o botão Salvar não bastava: o atendente abria Perfil, digitava no
 * nome do agente, trocava o tom de voz — e nada disso ia a lugar nenhum, porque
 * não havia onde gravar. Sumia o botão e ficava a promessa, que é a mesma
 * mentira que o botão respondendo 403 contava, só mais silenciosa.
 *
 * O `fieldset` desabilitado é a ferramenta do próprio navegador para isto: ele
 * desabilita nativamente todo controle de formulário que estiver dentro —
 * `input`, `textarea`, `select`, e também os `button` que o Radix usa por baixo
 * do Switch e do Select. Trinta campos em sete guias ficam cobertos por um
 * componente, e campo novo nasce coberto.
 *
 * `display: contents` tira a caixa do fieldset do layout, então nada se desloca.
 * A desabilitação é semântica e continua valendo.
 *
 * **O que ele não cobre:** o Slider do Radix desenha um `span[role=slider]`, que
 * não é controle de formulário e portanto escapa. São dois no sistema — em
 * Instruções e em Preferências — e cada um recebe o seu próprio `disabled`.
 */
export function CamposSomenteLeitura({
    ativo,
    children,
}: {
    ativo: boolean
    children: React.ReactNode
}) {
    if (!ativo) return <>{children}</>
    return (
        <fieldset disabled className="contents">
            {children}
        </fieldset>
    )
}
