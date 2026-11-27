import type { relatorioDeProdutos } from '@venn/core/lib/relatorios/consultas'

import { Numero, Quantia, Secao, SemHistorico, Tabela } from './Numeros'

/**
 * O que vende — **o primeiro relatório por produto que o produto pode ter**.
 *
 * Era impossível até 21/11/2026, e não por falta de tela: `Deal` não tinha
 * itens. O valor do negócio era um campo livre digitado, então não havia de
 * onde saber o que, dentro dele, foi vendido. `ProposalItem.productServiceId`
 * é o que mudou.
 *
 * ## A receita conta só o aceito
 *
 * Somar proposta em aberto daria uma receita que não entrou — e que cresceria
 * quando o vendedor mandasse mais propostas sem fechar nenhuma. O que está em
 * jogo tem lugar no relatório de propostas.
 *
 * ## A coluna mais acionável é "no catálogo"
 *
 * "Isto vendeu quarenta mil e está inativo" é o tipo de frase que muda uma
 * decisão na hora. Três estados, não dois: `null` é a linha escrita à mão, que
 * nunca esteve no catálogo — e dizer "inativo" para ela sugeriria que esteve.
 */

type Dados = Awaited<ReturnType<typeof relatorioDeProdutos>>

export function RelatorioDeProdutos({ dados }: { dados: Dados }) {
    if (dados.linhas.length === 0) {
        return (
            <SemHistorico
                oQue="itens de proposta"
                comoComecar="Esta tela conta o que foi vendido dentro das propostas do período. Ela se enche sozinha quando as propostas passarem a levar itens do catálogo."
            />
        )
    }

    const comReceita = dados.linhas.filter((l) => l.receita.length > 0).length
    const foraDoCatalogo = dados.linhas.filter((l) => l.ativoNoCatalogo === false)

    return (
        <>
            {/*
             * O aviso vem ANTES da tabela quando há item inativo que vendeu.
             *
             * É a única informação desta tela que pede ação imediata, e no fim
             * de uma tabela de cinquenta linhas ninguém a veria.
             */}
            {foraDoCatalogo.length > 0 && (
                <div className="mb-4 rounded-xl border border-border/60 bg-muted/40 px-4 py-3">
                    <p className="text-sm text-foreground">
                        {foraDoCatalogo.length === 1
                            ? 'Um item que vendeu neste período está inativo no catálogo'
                            : `${foraDoCatalogo.length} itens que venderam neste período estão inativos no catálogo`}
                        .
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Item inativo não aparece no seletor da proposta nem para o agente de IA.
                        Se ainda se vende, reative em {/* slug neutro nos três produtos */}
                        <span className="font-medium">Vendas</span> → catálogo.
                    </p>
                </div>
            )}

            <Secao
                titulo="O que vende"
                descricao={
                    comReceita === 0
                        ? 'Nenhum item fechou ainda neste período — a receita aparece quando a primeira proposta for aceita.'
                        : 'Receita conta só o que foi aceito. Ordenado pelo que mais entrou.'
                }
            >
                <Tabela
                    cabecalho={[
                        { rotulo: 'Item' },
                        { rotulo: 'Grupo' },
                        { rotulo: 'Catálogo' },
                        { rotulo: 'Propostas', numerico: true },
                        { rotulo: 'Aceitas', numerico: true },
                        { rotulo: 'Taxa', numerico: true },
                        { rotulo: 'Qtd.', numerico: true },
                        { rotulo: 'Receita aceita', numerico: true },
                    ]}
                >
                    {dados.linhas.map((l) => (
                        <tr key={l.productServiceId ?? `texto:${l.descricao}`}>
                            <td className="max-w-[260px] px-3 py-2.5">
                                <span className="block truncate font-medium text-foreground">
                                    {l.descricao}
                                </span>
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground">
                                {l.grupo ?? <span className="text-muted-foreground/60">&mdash;</span>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                                {l.ativoNoCatalogo === null ? (
                                    <span
                                        className="text-muted-foreground"
                                        title="Linha escrita à mão na proposta: nunca esteve no catálogo"
                                    >
                                        fora do catálogo
                                    </span>
                                ) : l.ativoNoCatalogo ? (
                                    <span className="text-muted-foreground">ativo</span>
                                ) : (
                                    <span
                                        className="font-medium text-destructive"
                                        title="Vendeu neste período e está inativo"
                                    >
                                        inativo
                                    </span>
                                )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                                <Numero valor={l.propostas} />
                            </td>
                            <td className="px-3 py-2.5 text-right">
                                <Numero valor={l.aceitas} />
                            </td>
                            <td className="px-3 py-2.5 text-right">
                                <Numero
                                    valor={l.taxaDeAceite}
                                    sufixo="%"
                                    casas={l.taxaDeAceite === null ? 0 : 1}
                                />
                            </td>
                            <td className="px-3 py-2.5 text-right">
                                <Numero valor={l.quantidade} casas={Number.isInteger(l.quantidade) ? 0 : 2} />
                            </td>
                            <td className="px-3 py-2.5 text-right">
                                <Quantia quantias={l.receita} />
                            </td>
                        </tr>
                    ))}
                </Tabela>
            </Secao>

            {/*
             * As linhas escritas à mão, agrupadas, são um achado de produto: um
             * "Deslocamento" cobrado quarenta vezes é um item que falta
             * cadastrar. A nota aparece só quando há o que notar.
             */}
            {dados.linhas.some((l) => l.productServiceId === null) && (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    As linhas marcadas como <span className="font-medium">fora do catálogo</span> foram
                    escritas à mão na proposta e estão agrupadas pela descrição. Se alguma se repete
                    muito, provavelmente deveria estar no catálogo.
                </p>
            )}
        </>
    )
}
