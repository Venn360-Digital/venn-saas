import type { QuantiaPorMoeda } from '@venn/core/lib/relatorios/metricas'

/**
 * As peças de apresentação compartilhadas pelos três relatórios.
 *
 * ## A regra que atravessa todas elas: `null` não é zero
 *
 * `metricas.ts` devolve `null` quando o denominador é vazio, e a tela tem de
 * **preservar** essa distinção. "Taxa de aceite: —" diz "ainda não há o que
 * medir"; "Taxa de aceite: 0%" diz "você mandou propostas e nenhuma foi
 * aceita". Para quem acabou de instalar o produto, a segunda frase é falsa e
 * desanimadora — é o "dashboard que mostra zeros" de que o estudo avisa.
 *
 * Então nenhum `?? 0` neste arquivo. O travessão é informação.
 */

/** O travessão de "não há o que medir". Um lugar só, para não virar dois. */
export function SemDado({ dica }: { dica?: string }) {
    return (
        <span className="text-muted-foreground" title={dica ?? 'Ainda não há dados para esta conta'}>
            &mdash;
        </span>
    )
}

export function Numero({
    valor,
    sufixo,
    casas = 0,
}: {
    valor: number | null
    sufixo?: string
    casas?: number
}) {
    if (valor === null) return <SemDado />
    return (
        <span className="tabular-nums">
            {valor.toLocaleString('pt-BR', {
                minimumFractionDigits: casas,
                maximumFractionDigits: casas,
            })}
            {sufixo ? <span className="ml-0.5 text-muted-foreground">{sufixo}</span> : null}
        </span>
    )
}

/**
 * Uma quantia, ou várias — **nunca somadas entre moedas**.
 *
 * Com uma moeda só, o caso de praticamente toda unidade, isto se lê como um
 * número. Com duas, aparecem duas linhas: somá-las daria um valor que não é
 * dinheiro nenhum, e mostrá-lo com o símbolo de uma das duas seria pior que
 * não mostrar.
 */
export function Quantia({ quantias }: { quantias: readonly QuantiaPorMoeda[] }) {
    if (quantias.length === 0) return <SemDado dica="Nenhum valor neste recorte" />
    return (
        <span className="inline-flex flex-col gap-0.5">
            {quantias.map((q) => (
                <span key={q.moeda} className="tabular-nums">
                    {q.total.toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: q.moeda,
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                    })}
                </span>
            ))}
        </span>
    )
}

/** Um número grande com rótulo — a unidade de leitura do relatório. */
export function Metrica({
    rotulo,
    children,
    dica,
    destaque = false,
}: {
    rotulo: string
    children: React.ReactNode
    dica?: string
    destaque?: boolean
}) {
    return (
        <div className="rounded-xl border border-border/60 bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</p>
            <p className={destaque ? 'mt-1.5 text-2xl font-semibold text-foreground' : 'mt-1.5 text-xl font-semibold text-foreground'}>
                {children}
            </p>
            {dica && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{dica}</p>}
        </div>
    )
}

/** Uma faixa de métricas. Duas colunas no celular, quatro no desktop. */
export function Faixa({ children }: { children: React.ReactNode }) {
    return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
}

export function Secao({
    titulo,
    descricao,
    children,
}: {
    titulo: string
    descricao?: string
    children: React.ReactNode
}) {
    return (
        <section className="mt-6 first:mt-0">
            <header className="mb-3">
                <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
                {descricao && <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>}
            </header>
            {children}
        </section>
    )
}

/**
 * O aviso de que o período não tem o que mostrar.
 *
 * Diferente de uma tela vazia: diz **por que** está vazio e o que fazer. O
 * aviso do estudo do Ploomes é literal — *"sem os dados das fases anteriores,
 * um dashboard mostra zeros"* — e a resposta certa a isso não é mostrar zeros
 * com elegância, é dizer que ainda não há histórico.
 */
export function SemHistorico({ oQue, comoComecar }: { oQue: string; comoComecar: string }) {
    return (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">Nada em {oQue} neste período</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                {comoComecar}
            </p>
        </div>
    )
}

/** Uma tabela simples de relatório, que rola na horizontal sem empurrar a página. */
export function Tabela({
    cabecalho,
    children,
}: {
    cabecalho: readonly { rotulo: string; numerico?: boolean }[]
    children: React.ReactNode
}) {
    return (
        // O `overflow-x-auto` é no contêiner, não no `body`: tabela larga rola
        // dentro de si em vez de fazer a página rolar de lado.
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-border/60">
                        {cabecalho.map((c) => (
                            <th
                                key={c.rotulo}
                                scope="col"
                                className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground ${
                                    c.numerico ? 'text-right' : 'text-left'
                                }`}
                            >
                                {c.rotulo}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-border/60">{children}</tbody>
            </table>
        </div>
    )
}
