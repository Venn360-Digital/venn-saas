import type { relatorioDeFunil } from '@venn/core/lib/relatorios/consultas'

import { Faixa, Metrica, Numero, Quantia, Secao, SemHistorico, Tabela } from './Numeros'

/**
 * O funil: quanto tempo em cada etapa, e **onde ele vaza**.
 *
 * ## O que esta tela responde e o painel não
 *
 * O Dashboard já tem conversão e dias por fase na visão de gráfico. O que ele
 * não responde é *onde* o funil vaza — qual etapa consome os negócios e quanto
 * dinheiro sai por ela. "Perdeu na Proposta" é um dado diferente de "a
 * conversão caiu", e é o que diz o que consertar.
 *
 * ## A última etapa de cada negócio não entra no tempo
 *
 * Ele ainda está lá. Medir "até agora" misturaria tempo decorrido com tempo
 * gasto, e um negócio aberto há seis meses na primeira etapa inflaria a mediana
 * de uma etapa pela qual todos passam em um dia. Então a coluna "passaram"
 * conta todos, e a de dias conta só quem saiu — por isso as duas não batem, e a
 * descrição diz isso.
 */

type Dados = Awaited<ReturnType<typeof relatorioDeFunil>>

export function RelatorioDeFunil({ dados }: { dados: Dados }) {
    const semNada = dados.etapas.length === 0 && dados.perdas.length === 0 && dados.ganhos.quantos === 0

    if (semNada) {
        return (
            <SemHistorico
                oQue="negócios"
                comoComecar="Esta tela mede a passagem dos negócios pelas etapas do funil. Ela precisa de negócios criados no período e de pelo menos uma mudança de etapa."
            />
        )
    }

    const totalPerdidos = dados.perdas.reduce((s, p) => s + p.perdidos, 0)
    const decididos = dados.ganhos.quantos + totalPerdidos

    return (
        <>
            <Secao titulo="Desfecho no período" descricao="Negócios fechados — ganhos ou perdidos — nestas datas.">
                <Faixa>
                    <Metrica rotulo="Ganhos" destaque>
                        <Numero valor={dados.ganhos.quantos} />
                    </Metrica>
                    <Metrica rotulo="Perdidos" destaque>
                        <Numero valor={totalPerdidos} />
                    </Metrica>
                    <Metrica
                        rotulo="Taxa de ganho"
                        dica="Sobre os que fecharam. Negócio aberto não entra."
                        destaque
                    >
                        {/*
                         * `null` quando nada fechou — não 0%. Uma unidade que
                         * tem negócios abertos e nenhum fechado não tem taxa de
                         * ganho zero; ela não tem taxa.
                         */}
                        <Numero
                            valor={decididos > 0 ? Math.round((dados.ganhos.quantos / decididos) * 1000) / 10 : null}
                            sufixo="%"
                            casas={decididos > 0 ? 1 : 0}
                        />
                    </Metrica>
                    <Metrica rotulo="Valor ganho">
                        <Quantia quantias={dados.ganhos.valor} />
                    </Metrica>
                </Faixa>
            </Secao>

            {dados.etapas.length > 0 && (
                <Secao
                    titulo="Tempo em cada etapa"
                    descricao="Na ordem do funil. “Passaram” conta todos; os dias contam só quem já saiu da etapa."
                >
                    <Tabela
                        cabecalho={[
                            { rotulo: 'Etapa' },
                            { rotulo: 'Passaram', numerico: true },
                            { rotulo: 'Dias (mediana)', numerico: true },
                            { rotulo: 'Dias (média)', numerico: true },
                        ]}
                    >
                        {dados.etapas.map((e) => (
                            <tr key={e.stageId}>
                                <td className="px-3 py-2.5 font-medium text-foreground">{e.nome}</td>
                                <td className="px-3 py-2.5 text-right">
                                    <Numero valor={e.passaram} />
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                    <Numero valor={e.diasMediana} casas={e.diasMediana === null ? 0 : 1} />
                                </td>
                                <td className="px-3 py-2.5 text-right text-muted-foreground">
                                    <Numero valor={e.diasMedia} casas={e.diasMedia === null ? 0 : 1} />
                                </td>
                            </tr>
                        ))}
                    </Tabela>
                </Secao>
            )}

            {dados.perdas.length > 0 && (
                <Secao
                    titulo="Onde o funil vaza"
                    descricao="A etapa em que o negócio estava ao ser perdido, e o motivo que foi registrado."
                >
                    <Tabela
                        cabecalho={[
                            { rotulo: 'Perdido na etapa' },
                            { rotulo: 'Quantos', numerico: true },
                            { rotulo: 'Valor que saiu', numerico: true },
                            { rotulo: 'Motivos' },
                        ]}
                    >
                        {dados.perdas.map((p) => (
                            <tr key={p.stageId ?? 'sem-etapa'}>
                                <td className="px-3 py-2.5 font-medium text-foreground">{p.nome}</td>
                                <td className="px-3 py-2.5 text-right">
                                    <Numero valor={p.perdidos} />
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                    <Quantia quantias={p.valor} />
                                </td>
                                <td className="px-3 py-2.5 text-muted-foreground">
                                    {p.motivos.map((m) => `${m.nome} (${m.quantos})`).join(' · ')}
                                </td>
                            </tr>
                        ))}
                    </Tabela>
                </Secao>
            )}
        </>
    )
}
