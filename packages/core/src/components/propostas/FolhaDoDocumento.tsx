'use client'

import { cssDoDocumento } from '../../lib/propostas/estilo'

/**
 * A folha que o cliente recebe — **um desenho só**, para o editor e para o link.
 *
 * ## Por que existe
 *
 * O "Visualizar" do editor mostrava apenas o HTML do documento, solto dentro do
 * painel. O cliente recebe esse mesmo HTML **dentro de uma folha**: logotipo da
 * organização, rótulo e número do documento, nome da organização, o total, tudo
 * num cartão de largura de leitura sobre um fundo.
 *
 * A diferença não é decoração: era a reclamação do André em 27/11/2026, depois
 * de dois consertos que ainda não fechavam o buraco. Ele pediu que a
 * visualização fosse "exatamente como o cliente vai receber", e o que faltava já
 * não era o tema — era a moldura.
 *
 * ## O mesmo argumento do render
 *
 * `render.ts` existe numa função só porque dois renders divergiriam num centavo
 * e o hash do aceite deixaria de bater. A moldura tem a mesma natureza: duas
 * cópias divergem, e divergem caladas, porque ninguém compara telas lado a lado
 * todo dia. Então a página pública e a prévia do editor desenham por aqui.
 *
 * ## O que ela NÃO faz
 *
 * Não decide o aceite. O bloco de aceite é interação, e é diferente nos dois
 * lados: no link ele é um formulário de verdade; na prévia é ilustração. Por
 * isso ele entra por `rodape`, e cada chamador põe o seu.
 *
 * Não hasheia nada. O `html` chega pronto do servidor e é o que o aceite
 * registra; `chrome`, logotipo e tema ficam de fora dele, pelas razões de
 * `publico.ts`.
 */

export interface CabecalhoDaFolha {
    /** O logotipo da organização, como URL. Nulo quando não há. */
    logo: string | null
    /** "Proposta", "Orçamento", "Contrato". */
    rotulo: string
    numero: number
    organizacao: string
    totalEmTexto: string
}

export function FolhaDoDocumento({
    escopo,
    cabecalho,
    tema,
    html,
    chrome,
    rodape,
    acao,
}: {
    /**
     * O seletor de CSS deste desenho: `.documento-publico` no link,
     * `.documento-previa` no editor.
     *
     * Dois escopos e não um porque as duas telas carregam folhas globais
     * diferentes, e o CSS do documento é escopado para não vazar.
     */
    escopo: string
    cabecalho: CabecalhoDaFolha
    /** O `theme` do modelo, cru. `cssDoDocumento` o lê. */
    tema: unknown
    /** O documento, já montado e escapado pelo servidor. */
    html: string
    /** Cabeçalho e rodapé de impressão, em HTML. Vazio quando não há. */
    chrome?: string
    /** O bloco de aceite, ou o que cada tela puser abaixo do documento. */
    rodape?: React.ReactNode
    /** Ação no topo, fora da folha — "Baixar PDF" no link. */
    acao?: React.ReactNode
}) {
    return (
        <div className="mx-auto w-full max-w-3xl">
            {acao ? <div className="mb-3 flex justify-end print:hidden">{acao}</div> : null}

            <article className="documento-publico-moldura rounded-xl border border-border/60 bg-card p-6 shadow-sm sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none">
                <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-5">
                    <div className="flex items-center gap-3">
                        {/* `alt` com o nome: o leitor de tela lê a organização, não "imagem". */}
                        {cabecalho.logo && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={cabecalho.logo}
                                alt={cabecalho.organizacao}
                                className="h-10 w-auto max-w-[9rem] object-contain"
                            />
                        )}
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {cabecalho.rotulo} {cabecalho.numero}
                            </p>
                            <p className="mt-1 text-base font-semibold text-foreground">
                                {cabecalho.organizacao}
                            </p>
                        </div>
                    </div>
                    <p className="text-lg font-semibold tabular-nums text-foreground">
                        {cabecalho.totalEmTexto}
                    </p>
                </header>

                <div className={escopo.replace('.', '')}>
                    {/*
                     * A moldura de impressão vem antes e fora do `html`: ela
                     * carrega a marca da conta, que muda sozinha, e o `html` é o
                     * que o aceite hasheia. Na tela ela não aparece; existe para
                     * a folha impressa, onde se repete a cada página.
                     */}
                    {chrome ? <div dangerouslySetInnerHTML={{ __html: chrome }} /> : null}
                    {/* HTML nosso: o servidor escapou tudo o que vem de fora. */}
                    <div dangerouslySetInnerHTML={{ __html: html }} />
                </div>

                {rodape}
            </article>

            {/*
             * O CSS fica ao lado do documento, e não na folha global, porque ele
             * é do documento: a folha global não o conhece e não deve conhecer.
             * Pinta com o tema inteiro — paleta, fonte e capa —, que é o que faz
             * esta prévia ser a mesma coisa que o cliente vê.
             */}
            <style>{cssDoDocumento(escopo, tema)}</style>
        </div>
    )
}
