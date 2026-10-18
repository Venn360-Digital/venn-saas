import { getDashboardCharts } from '@/lib/dashboard/charts'
import {
    BarList,
    ChartCard,
    ChartHero,
    CumulativeChart,
    EmptyChart,
    Heatmap,
    PairedBars,
    ReferenceLineChart,
    compactBRL,
    fullBRL,
    type BarRow,
} from './ChartPrimitives'

/**
 * A visão Gráfico, em três faixas.
 *
 * Não é uma grade de nove quadros: são três perguntas, em ordem — **o
 * dinheiro**, **a demanda**, **o trabalho**. Quem abre o painel de manhã lê a
 * primeira faixa e fecha; quem está planejando a semana desce.
 *
 * Três gráficos exigem um período para existir (acumulado, atividades,
 * conversão): eles comparam com o intervalo anterior, e "todo o período" não
 * tem anterior. Nesse caso o cartão diz isso em vez de desenhar uma linha reta
 * sem sentido.
 */
export async function GraphView({
    workspaceId,
    from,
    to,
    userId,
}: {
    workspaceId: string
    from: string
    to: string
    userId: string | null
}) {
    const data = await getDashboardCharts(workspaceId, { from, to, userId })

    const revenueDelta =
        data.revenue.previousTotal > 0
            ? ((data.revenue.total - data.revenue.previousTotal) / data.revenue.previousTotal) * 100
            : null

    const maxSource = Math.max(1, ...data.sources.map((s) => s.count))
    // Motivo registrado sem valor no negócio existe — e com todos em R$ 0 a
    // barra virava um toco de 1,5% que lê como defeito de renderização. Sem
    // valor nenhum, o comprimento passa a medir a contagem, que é o que sobra
    // de verdadeiro.
    const lossByCount = data.lossReasons.every((r) => r.value === 0)
    const maxLoss = lossByCount
        ? Math.max(1, ...data.lossReasons.map((r) => r.count))
        : Math.max(1, ...data.lossReasons.map((r) => r.value))
    const userByCount = data.byUser.every((u) => u.value === 0)
    const maxUser = userByCount
        ? Math.max(1, ...data.byUser.map((u) => u.won))
        : Math.max(1, ...data.byUser.map((u) => u.value))
    const maxStageDays = Math.max(1, ...data.stageDays.stages.map((s) => s.days))

    const sourceRows: BarRow[] = data.sources.map((source) => ({
        key: source.source,
        // Já vem com o nome que a clínica deu à origem: o de-para acontece em
        // `getDashboardCharts`, que é quem tem a lista em mãos.
        label: source.source,
        percent: (source.count / maxSource) * 100,
        value: source.count.toLocaleString('pt-BR'),
        note:
            source.delta === null || source.delta === 0
                ? undefined
                : source.delta > 0
                    ? `${source.delta} a mais que no período anterior`
                    : `${Math.abs(source.delta)} a menos que no período anterior`,
    }))

    const lossRows: BarRow[] = data.lossReasons.map((reason) => ({
        key: reason.name,
        label: reason.name,
        percent: ((lossByCount ? reason.count : reason.value) / maxLoss) * 100,
        value: fullBRL(reason.value),
        note: `${reason.count} negócio${reason.count === 1 ? '' : 's'} perdido${reason.count === 1 ? '' : 's'}`,
        tone: 'loss',
    }))

    const userRows: BarRow[] = data.byUser.map((person) => ({
        key: person.userId ?? 'sem-responsavel',
        label: person.name,
        percent: ((userByCount ? person.won : person.value) / maxUser) * 100,
        value: fullBRL(person.value),
        note: `${person.won} fechado${person.won === 1 ? '' : 's'}${person.rate !== null ? ` · ${person.rate.toFixed(0)}% de conversão` : ''}`,
        // Sem responsável fica cinza e não disputa com a equipe: é aviso de
        // cadastro, não desempenho de ninguém.
        tone: person.userId ? 'series' : 'muted',
    }))

    const stageRows: BarRow[] = data.stageDays.stages.map((stage) => ({
        key: stage.id,
        label: stage.name,
        percent: (stage.days / maxStageDays) * 100,
        value: `${stage.days.toFixed(1).replace('.', ',')} d`,
        dot: stage.color,
        tone: stage.id === data.stageDays.slowestId ? 'warn' : 'series',
        note:
            stage.id === data.stageDays.slowestId
                ? 'o gargalo: é aqui que o negócio mais espera'
                : undefined,
    }))

    const funnelRows: BarRow[] = data.funnel.map((stage) => ({
        key: stage.id,
        label: stage.name,
        percent: stage.pass ? stage.pass.rate : 0,
        value: stage.pass ? `${stage.pass.rate.toFixed(0)}%` : '—',
        dot: stage.color,
        note: stage.pass
            ? `${stage.pass.entered} entraram nesta fase`
            : 'última fase do funil',
    }))

    return (
        <div className="space-y-6">
            <Band title="O dinheiro" />

            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                <ChartCard
                    title="Estamos à frente ou atrás?"
                    hint="Receita fechada acumulada, contra o mesmo ponto do período anterior."
                >
                    {data.hasWindow && data.revenue.series.length > 0 ? (
                        <>
                            <ChartHero
                                value={fullBRL(data.revenue.total)}
                                delta={
                                    revenueDelta === null
                                        ? null
                                        : {
                                            text: `${Math.abs(revenueDelta).toFixed(1).replace('.', ',')}%`,
                                            direction:
                                                revenueDelta > 0 ? 'up' : revenueDelta < 0 ? 'down' : 'flat',
                                            good: revenueDelta >= 0,
                                        }
                                }
                                hint={`vs. ${fullBRL(data.revenue.previousTotal)} no período anterior`}
                            />
                            <CumulativeChart
                                points={data.revenue.series}
                                format={compactBRL}
                                labelCurrent="Este período"
                                labelPrevious="Período anterior"
                            />
                        </>
                    ) : (
                        <EmptyChart>
                            Escolha um período para comparar com o intervalo anterior.
                        </EmptyChart>
                    )}
                </ChartCard>

                <ChartCard
                    title="Quanto passa de cada fase"
                    hint="De quem entrou na fase, quantos chegaram a alguma fase adiante."
                    footer="O ponto é a cor que a clínica deu à fase. A barra é sempre a mesma cor — comprimento mede, rótulo identifica."
                >
                    {funnelRows.some((row) => row.value !== '—') ? (
                        <BarList rows={funnelRows} />
                    ) : (
                        <EmptyChart>
                            Nenhuma passagem de fase registrada ainda. A jornada do negócio alimenta
                            este gráfico.
                        </EmptyChart>
                    )}
                </ChartCard>
            </div>

            <Band title="A demanda" />

            <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard
                    title="Quando o paciente procura"
                    hint="Mensagens recebidas por dia da semana e faixa de duas horas."
                    footer="Para dimensionar o plantão: o pico diz onde colocar gente, e o vazio diz o que a clínica não cobre."
                >
                    {data.heatmap.max > 0 ? (
                        <Heatmap
                            grid={data.heatmap.grid}
                            slots={data.heatmap.slots}
                            max={data.heatmap.max}
                        />
                    ) : (
                        <EmptyChart>Nenhuma mensagem recebida neste período.</EmptyChart>
                    )}
                </ChartCard>

                <ChartCard
                    title="De onde vêm os pacientes novos"
                    hint="Cadastros no período, por origem."
                    footer="A variação vem escrita, não numa segunda cor de barra: quem não distingue verde de vermelho continua lendo “a mais” e “a menos”."
                >
                    {sourceRows.length > 0 ? (
                        <BarList rows={sourceRows} />
                    ) : (
                        <EmptyChart>Nenhum paciente novo neste período.</EmptyChart>
                    )}
                </ChartCard>
            </div>

            <Band title="O trabalho" />

            <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard
                    title="Por que perdemos"
                    hint="Motivo registrado no fechamento, pelo valor que saiu com ele."
                    footer="Vermelho aqui é estado, não série: é a cor reservada de perda, e vem com a palavra ao lado."
                >
                    {lossRows.length > 0 ? (
                        <BarList rows={lossRows} />
                    ) : (
                        <EmptyChart>Nenhum negócio perdido neste período.</EmptyChart>
                    )}
                </ChartCard>

                <ChartCard
                    title="A equipe fecha o que abre?"
                    hint="Criadas e concluídas ao longo do período, pela data de vencimento."
                >
                    {data.hasWindow && data.activities.series.length > 0 ? (
                        <>
                            <ChartHero
                                value={
                                    data.activities.rate === null
                                        ? '—'
                                        : `${data.activities.rate.toFixed(0)}%`
                                }
                                hint={`${data.activities.completed} concluídas de ${data.activities.created} criadas`}
                            />
                            <PairedBars
                                points={data.activities.series}
                                labelCurrent="Concluídas"
                                labelPrevious="Criadas"
                            />
                        </>
                    ) : (
                        <EmptyChart>Escolha um período para ver o ritmo da equipe.</EmptyChart>
                    )}
                </ChartCard>

                <ChartCard
                    title="Quem fecha"
                    hint="Valor ganho por responsável no período."
                >
                    {userRows.length > 0 ? (
                        <BarList rows={userRows} />
                    ) : (
                        <EmptyChart>Nenhum negócio ganho neste período.</EmptyChart>
                    )}
                </ChartCard>

                <ChartCard
                    title="Onde o funil segura"
                    hint="Dias que o negócio passa, em média, em cada fase."
                >
                    {stageRows.length > 0 ? (
                        <>
                            <ChartHero
                                value={data.stageDays.cycleDays.toFixed(1).replace('.', ',')}
                                hint="dias do primeiro contato ao fechamento"
                            />
                            <BarList rows={stageRows} />
                        </>
                    ) : (
                        <EmptyChart>
                            Ainda não há passagens de fase suficientes para calcular uma média.
                        </EmptyChart>
                    )}
                </ChartCard>

                <ChartCard
                    title="A conversão está subindo?"
                    hint="Ganhos sobre fechados. A régua é a média do período anterior."
                    className="lg:col-span-2"
                >
                    {data.hasWindow && data.conversion.series.some((p) => p.rate !== null) ? (
                        <ReferenceLineChart
                            points={data.conversion.series}
                            reference={data.conversion.previousRate}
                            referenceLabel={
                                data.conversion.previousRate === null
                                    ? ''
                                    : `${data.conversion.previousRate.toFixed(0)}% antes`
                            }
                        />
                    ) : (
                        <EmptyChart>
                            Nenhum negócio fechado neste período — sem fechamentos não há taxa.
                        </EmptyChart>
                    )}
                </ChartCard>
            </div>
        </div>
    )
}

/** O rótulo de uma faixa: diz qual pergunta os cartões abaixo respondem. */
function Band({ title }: { title: string }) {
    return (
        <div className="flex items-baseline gap-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {title}
            </h2>
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>
    )
}
