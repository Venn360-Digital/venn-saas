import type { relatorioDePropostas } from '@venn/core/lib/relatorios/consultas'

import { Faixa, Metrica, Numero, Quantia, Secao, SemHistorico, Tabela } from './Numeros'

/**
 * O relatório de propostas.
 *
 * ## O número que esta tela existe para mostrar
 *
 * **Enviadas que o cliente nunca abriu.** Nenhum CRM comum tem esse dado,
 * porque quem manda PDF anexo não sabe se foi lido. Aqui o documento é um link
 * e cada abertura é uma linha — então "cinco propostas enviadas, duas nunca
 * abertas" é informação acionável: aquelas duas não foram recusadas, foram
 * ignoradas, e a próxima ligação é outra.
 *
 * ## A taxa de aceite exclui o que ainda está em jogo
 *
 * O denominador é `aceitas + recusadas + expiradas`. Proposta enviada ontem,
 * dentro do prazo, não é uma derrota — e contá-la como tal faria a taxa piorar
 * sempre que o vendedor trabalhasse mais. A dica sob o número diz isso, porque
 * um gestor que não sabe o denominador desconfia do numerador.
 */

type Dados = Awaited<ReturnType<typeof relatorioDePropostas>>

export function RelatorioDePropostas({ dados }: { dados: Dados }) {
    const m = dados.metricas

    if (m.quantas === 0) {
        return (
            <SemHistorico
                oQue="propostas"
                comoComecar="Uma proposta nasce de um negócio: abra o negócio, monte os itens e mande o link ao cliente. As contas desta tela aparecem a partir da primeira."
            />
        )
    }

    const comProposta = dados.porTipo.filter((t) => t.metricas.quantas > 0)

    return (
        <>
            <Secao titulo="O que aconteceu" descricao="Propostas criadas no período.">
                <Faixa>
                    <Metrica rotulo="Criadas" destaque>
                        <Numero valor={m.quantas} />
                    </Metrica>
                    <Metrica rotulo="Enviadas" dica="Que chegaram a ter link compartilhado.">
                        <Numero valor={m.enviadas} />
                    </Metrica>
                    <Metrica rotulo="Aceitas" destaque>
                        <Numero valor={m.aceitas} />
                    </Metrica>
                    <Metrica
                        rotulo="Taxa de aceite"
                        dica="Sobre as que já foram decididas — as em aberto não contam."
                        destaque
                    >
                        <Numero valor={m.taxaDeAceite} sufixo="%" casas={m.taxaDeAceite === null ? 0 : 1} />
                    </Metrica>
                </Faixa>
            </Secao>

            <Secao
                titulo="Engajamento"
                descricao="O que o PDF anexo nunca contou: se o cliente abriu."
            >
                <Faixa>
                    <Metrica
                        rotulo="Nunca abertas"
                        dica="Enviadas que o cliente não abriu nenhuma vez."
                        destaque
                    >
                        <Numero valor={m.nuncaAbertas} />
                    </Metrica>
                    <Metrica rotulo="Nunca abertas">
                        <Numero
                            valor={m.taxaDeNuncaAbertas}
                            sufixo="%"
                            casas={m.taxaDeNuncaAbertas === null ? 0 : 1}
                        />
                    </Metrica>
                    <Metrica rotulo="Aberturas por proposta" dica="Média entre as enviadas.">
                        <Numero
                            valor={m.aberturasPorPropostaMedia}
                            casas={m.aberturasPorPropostaMedia === null ? 0 : 1}
                        />
                    </Metrica>
                    <Metrica rotulo="Em aberto" dica="Enviadas e ainda sem desfecho.">
                        <Numero valor={m.emAberto} />
                    </Metrica>
                </Faixa>
            </Secao>

            <Secao titulo="Quanto tempo e quantas voltas">
                <Faixa>
                    <Metrica
                        rotulo="Dias até o aceite"
                        dica="Mediana — uma proposta aceita em 90 dias não distorce o número."
                        destaque
                    >
                        <Numero
                            valor={m.diasAteAceiteMediana}
                            casas={m.diasAteAceiteMediana === null ? 0 : 1}
                        />
                    </Metrica>
                    <Metrica rotulo="Dias até o aceite (média)">
                        <Numero
                            valor={m.diasAteAceiteMedia}
                            casas={m.diasAteAceiteMedia === null ? 0 : 1}
                        />
                    </Metrica>
                    <Metrica
                        rotulo="Versões até o aceite"
                        dica="Quanto se renegocia antes de fechar."
                    >
                        <Numero
                            valor={m.versoesAteAceiteMedia}
                            casas={m.versoesAteAceiteMedia === null ? 0 : 1}
                        />
                    </Metrica>
                    <Metrica rotulo="Recusadas / expiradas">
                        <Numero valor={m.recusadas + m.expiradas} />
                    </Metrica>
                </Faixa>
            </Secao>

            <Secao titulo="Dinheiro" descricao="Cada moeda em sua linha: valores de moedas diferentes não somam.">
                <div className="grid gap-3 sm:grid-cols-2">
                    <Metrica rotulo="Valor aceito" destaque>
                        <Quantia quantias={m.valorAceito} />
                    </Metrica>
                    <Metrica rotulo="Valor em aberto" dica="O que ainda pode fechar.">
                        <Quantia quantias={m.valorEmAberto} />
                    </Metrica>
                </div>
            </Secao>

            {/*
             * A quebra por tipo só aparece quando há mais de um.
             *
             * Numa clínica que só faz orçamento, uma tabela de três linhas com
             * duas zeradas é ruído — e sugere que falta usar algo que ela não
             * precisa usar.
             */}
            {comProposta.length > 1 && (
                <Secao titulo="Por tipo de documento">
                    <Tabela
                        cabecalho={[
                            { rotulo: 'Tipo' },
                            { rotulo: 'Criadas', numerico: true },
                            { rotulo: 'Enviadas', numerico: true },
                            { rotulo: 'Aceitas', numerico: true },
                            { rotulo: 'Taxa', numerico: true },
                            { rotulo: 'Nunca abertas', numerico: true },
                            { rotulo: 'Valor aceito', numerico: true },
                        ]}
                    >
                        {comProposta.map((t) => (
                            <tr key={t.tipo}>
                                <td className="px-3 py-2.5 font-medium text-foreground">
                                    {t.tipo === 'orcamento'
                                        ? 'Orçamentos'
                                        : t.tipo === 'contrato'
                                          ? 'Contratos'
                                          : 'Propostas'}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                    <Numero valor={t.metricas.quantas} />
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                    <Numero valor={t.metricas.enviadas} />
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                    <Numero valor={t.metricas.aceitas} />
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                    <Numero
                                        valor={t.metricas.taxaDeAceite}
                                        sufixo="%"
                                        casas={t.metricas.taxaDeAceite === null ? 0 : 1}
                                    />
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                    <Numero valor={t.metricas.nuncaAbertas} />
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                    <Quantia quantias={t.metricas.valorAceito} />
                                </td>
                            </tr>
                        ))}
                    </Tabela>
                </Secao>
            )}
        </>
    )
}
