import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
    currentMembership,
    OVERSIGHT_ROLES,
    PERMISSION_DENIED,
} from '@venn/core/lib/auth/workspace'
import {
    relatorioDeFunil,
    relatorioDeProdutos,
    relatorioDePropostas,
} from '@venn/core/lib/relatorios/consultas'
import { TIPOS_DE_RELATORIO } from '@venn/core/lib/relatorios/tipos'
import {
    cabecalhosDeCsv,
    montarCsv,
    nomeDoArquivo,
    quantiasEmTexto,
    type ColunaDeCsv,
} from '@venn/core/lib/relatorios/csv'

/**
 * O relatório como CSV.
 *
 * Mesma consulta, mesmo recorte e mesma régua de papel do JSON: a exportação é
 * uma **projeção** do relatório, não um caminho paralelo. Esconder da tela não é
 * autorização, e exportar é o jeito mais fácil de contornar uma tela — por isso
 * os dois portões estão aqui também, não só lá.
 *
 * O número que sai aqui tem de ser o mesmo que a tela mostra. É por isso que a
 * exportação chama `relatorioDe*` em vez de uma consulta própria "otimizada
 * para CSV": duas consultas divergiriam, e a divergência apareceria como a
 * planilha discordando da tela, sem que nenhuma das duas pareça errada.
 */

export const dynamic = 'force-dynamic'

const escopoSchema = z.object({
    tipo: z.enum(TIPOS_DE_RELATORIO),
    de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
    ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
    userId: z.string().nullable().optional(),
    pipelineId: z.string().nullable().optional(),
})

export async function GET(request: NextRequest) {
    try {
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        if (!OVERSIGHT_ROLES.includes(membro.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const escopo = escopoSchema.parse({
            tipo: searchParams.get('tipo') ?? 'propostas',
            de: searchParams.get('de') ?? '',
            ate: searchParams.get('ate') ?? '',
            userId: searchParams.get('userId'),
            pipelineId: searchParams.get('pipelineId'),
        })

        if (escopo.de > escopo.ate) {
            return NextResponse.json({ error: 'A data inicial é posterior à final.' }, { status: 400 })
        }

        let csv: string

        if (escopo.tipo === 'propostas') {
            const dados = await relatorioDePropostas(membro, escopo)
            /**
             * O CSV de propostas é uma linha por TIPO mais uma de total.
             *
             * Uma linha por proposta seria a lista, não o relatório — e a lista
             * já tem a sua própria tela. Quem exporta um relatório quer a conta
             * para colar num slide.
             */
            type Linha = { rotulo: string; m: typeof dados.metricas }
            const linhas: Linha[] = [
                { rotulo: 'Total', m: dados.metricas },
                ...dados.porTipo
                    // Tipo sem nenhuma proposta no período não vira linha de
                    // zeros: ele simplesmente não aparece.
                    .filter((t) => t.metricas.quantas > 0)
                    .map((t) => ({ rotulo: rotuloDoTipo(t.tipo), m: t.metricas })),
            ]

            const colunas: ColunaDeCsv<Linha>[] = [
                { titulo: 'Recorte', valor: (l) => l.rotulo },
                { titulo: 'Criadas', valor: (l) => l.m.quantas },
                { titulo: 'Enviadas', valor: (l) => l.m.enviadas },
                { titulo: 'Aceitas', valor: (l) => l.m.aceitas },
                { titulo: 'Recusadas', valor: (l) => l.m.recusadas },
                { titulo: 'Expiradas', valor: (l) => l.m.expiradas },
                { titulo: 'Em aberto', valor: (l) => l.m.emAberto },
                // `null` vira célula VAZIA, não 0 — ver a decisão em `metricas.ts`.
                { titulo: 'Taxa de aceite (%)', valor: (l) => l.m.taxaDeAceite },
                { titulo: 'Dias até aceite (mediana)', valor: (l) => l.m.diasAteAceiteMediana },
                { titulo: 'Dias até aceite (média)', valor: (l) => l.m.diasAteAceiteMedia },
                { titulo: 'Versões até aceite (média)', valor: (l) => l.m.versoesAteAceiteMedia },
                { titulo: 'Nunca abertas', valor: (l) => l.m.nuncaAbertas },
                { titulo: 'Nunca abertas (%)', valor: (l) => l.m.taxaDeNuncaAbertas },
                { titulo: 'Aberturas por proposta', valor: (l) => l.m.aberturasPorPropostaMedia },
                { titulo: 'Valor aceito', valor: (l) => quantiasEmTexto(l.m.valorAceito) },
                { titulo: 'Valor em aberto', valor: (l) => quantiasEmTexto(l.m.valorEmAberto) },
            ]
            csv = montarCsv(colunas, linhas)
        } else if (escopo.tipo === 'produtos') {
            const dados = await relatorioDeProdutos(membro, escopo)
            type Linha = (typeof dados.linhas)[number]
            const colunas: ColunaDeCsv<Linha>[] = [
                { titulo: 'Item', valor: (l) => l.descricao },
                { titulo: 'Grupo', valor: (l) => l.grupo },
                {
                    titulo: 'No catálogo',
                    // Três estados, não dois: `null` é a linha escrita à mão,
                    // que nunca esteve no catálogo.
                    valor: (l) => (l.ativoNoCatalogo === null ? 'fora do catálogo' : l.ativoNoCatalogo ? 'ativo' : 'inativo'),
                },
                { titulo: 'Propostas', valor: (l) => l.propostas },
                { titulo: 'Aceitas', valor: (l) => l.aceitas },
                { titulo: 'Taxa de aceite (%)', valor: (l) => l.taxaDeAceite },
                { titulo: 'Quantidade', valor: (l) => l.quantidade },
                { titulo: 'Receita aceita', valor: (l) => quantiasEmTexto(l.receita) },
            ]
            csv = montarCsv(colunas, dados.linhas)
        } else {
            const dados = await relatorioDeFunil(membro, escopo)
            /**
             * O funil exporta DUAS tabelas no mesmo arquivo, separadas por uma
             * linha em branco.
             *
             * Tempo por etapa e onde vaza respondem perguntas diferentes e têm
             * colunas diferentes; forçá-las na mesma grade deixaria metade das
             * células vazias em toda linha. Duas tabelas num arquivo é o que
             * uma planilha aceita e uma pessoa lê.
             */
            type Etapa = (typeof dados.etapas)[number]
            const etapas: ColunaDeCsv<Etapa>[] = [
                { titulo: 'Etapa', valor: (l) => l.nome },
                { titulo: 'Negócios que passaram', valor: (l) => l.passaram },
                { titulo: 'Dias na etapa (mediana)', valor: (l) => l.diasMediana },
                { titulo: 'Dias na etapa (média)', valor: (l) => l.diasMedia },
            ]
            type Perda = (typeof dados.perdas)[number]
            const perdas: ColunaDeCsv<Perda>[] = [
                { titulo: 'Perdido na etapa', valor: (l) => l.nome },
                { titulo: 'Quantos', valor: (l) => l.perdidos },
                { titulo: 'Valor perdido', valor: (l) => quantiasEmTexto(l.valor) },
                {
                    titulo: 'Motivos',
                    valor: (l) => l.motivos.map((m) => `${m.nome} (${m.quantos})`).join(' · '),
                },
            ]
            csv = montarCsv(etapas, dados.etapas) + '\r\n' + montarCsv(perdas, dados.perdas)
        }

        return new NextResponse(csv, {
            headers: cabecalhosDeCsv(nomeDoArquivo(escopo.tipo, escopo.de, escopo.ate)),
        })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[RELATORIOS_EXPORT]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

function rotuloDoTipo(tipo: string): string {
    if (tipo === 'orcamento') return 'Orçamentos'
    if (tipo === 'contrato') return 'Contratos'
    return 'Propostas'
}
