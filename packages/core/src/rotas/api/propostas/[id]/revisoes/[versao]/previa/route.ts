import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { currentMembership } from '@venn/core/lib/auth/workspace'
import { propostaVisivel, revisaoVisivel } from '@venn/core/lib/propostas/acesso'
import { contextoDeMapa, contextoDeVariaveis } from '@venn/core/lib/propostas/contexto'
import { urlDaCapaDe } from '@venn/core/lib/propostas/capa'
import { chromeDoDocumento, renderDocumento } from '@venn/core/lib/propostas/render'
import { dinheiroEmTexto } from '@venn/core/lib/propostas/calculo'
import { ROTULO_DO_TIPO, type TipoDeDocumento } from '@venn/core/lib/propostas/estados'
import { converterCorpoEmSecoes, secoesPadrao, secoesSchema } from '@venn/core/lib/propostas/secoes'

/**
 * A prévia: o documento em HTML, pronto, para o modo Visualizar do editor.
 *
 * ## Por que o editor não renderiza sozinho
 *
 * `renderDocumento` importa o cálculo, que importa o Prisma — e qualquer
 * módulo de servidor arrastado para uma tela `'use client'` leva o driver do
 * banco para o navegador (regra 7 de `check-marca.mjs`). Mas a razão de fundo
 * é outra: a prévia e a página pública **têm** de ser a mesma função, senão o
 * hash do aceite não corresponde ao que o vendedor viu. Então o editor pede o
 * HTML pronto, e esta rota é o único lugar de onde ele vem.
 *
 * ## Enviada mostra o congelado; rascunho mostra o vivo
 *
 * Revisão com `sections`/`variableValues` gravados (enviada) renderiza o que
 * foi congelado — é o que o cliente tem na mão. Rascunho renderiza o modelo
 * vivo com os valores de agora, que é o que a pessoa está editando.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; versao: string }> }) {
    try {
        const { id, versao } = await params
        const v = Number(versao)
        if (!Number.isInteger(v) || v < 1) {
            return NextResponse.json({ error: 'Versão inválida' }, { status: 400 })
        }

        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const proposta = await propostaVisivel(membro, id)
        if (!proposta) {
            return NextResponse.json({ error: 'Proposta não encontrada' }, { status: 404 })
        }
        const visivel = await revisaoVisivel(membro, id, v)
        if (!visivel) {
            return NextResponse.json({ error: 'Revisão não encontrada' }, { status: 404 })
        }

        const r = await prisma.proposalRevision.findUnique({
            where: { id: visivel.id },
            select: {
                subtotal: true,
                discount: true,
                total: true,
                validUntil: true,
                notes: true,
                sections: true,
                variableValues: true,
                items: {
                    orderBy: { order: 'asc' },
                    select: {
                        description: true,
                        quantity: true,
                        unitPrice: true,
                        discountPct: true,
                        total: true,
                        productService: { select: { unit: true } },
                    },
                },
                proposal: {
                    select: {
                        kind: true,
                        title: true,
                        number: true,
                        currency: true,
                        createdAt: true,
                        template: { select: { body: true, sections: true, theme: true } },
                        createdBy: { select: { name: true, email: true, phone: true } },
                        workspace: { select: { name: true, cnpj: true, address: true, phone: true, logo: true } },
                        deal: {
                            select: {
                                title: true,
                                value: true,
                                createdAt: true,
                                stage: { select: { name: true } },
                                contact: { select: { name: true, phone: true, email: true, customFields: true } },
                            },
                        },
                    },
                },
            },
        })
        if (!r) {
            return NextResponse.json({ error: 'Revisão não encontrada' }, { status: 404 })
        }

        const p = r.proposal

        // O congelado quando existe; senão o vivo. Ver o cabeçalho.
        const congeladas = secoesSchema.safeParse(r.sections)
        const doModelo = secoesSchema.safeParse(p.template?.sections)
        const secoes = congeladas.success && congeladas.data.length > 0
            ? congeladas.data
            : doModelo.success && doModelo.data.length > 0
              ? doModelo.data
              : (() => {
                    const c = converterCorpoEmSecoes(p.template?.body)
                    return c.length > 0 ? c : secoesPadrao()
                })()

        const variaveis =
            r.variableValues && typeof r.variableValues === 'object'
                ? contextoDeMapa(r.variableValues)
                : contextoDeVariaveis({
                      contato: p.deal.contact,
                      organizacao: p.workspace,
                      documento: {
                          kind: p.kind,
                          number: p.number,
                          title: p.title,
                          createdAt: p.createdAt,
                          validUntil: r.validUntil,
                          subtotal: r.subtotal,
                          discount: r.discount,
                          total: r.total,
                          moeda: p.currency,
                          observacao: r.notes,
                      },
                      negocio: {
                          title: p.deal.title,
                          value: p.deal.value,
                          stageName: p.deal.stage?.name ?? null,
                          createdAt: p.deal.createdAt,
                      },
                      responsavel: p.createdBy,
                  })

        const html = renderDocumento({
            secoes,
            variaveis,
            itens: r.items.map((i) => ({
                description: i.description,
                quantity: i.quantity.toString(),
                unitPrice: i.unitPrice.toString(),
                discountPct: i.discountPct.toString(),
                total: i.total.toString(),
                unit: i.productService?.unit ?? null,
            })),
            totais: { subtotal: r.subtotal, discount: r.discount, total: r.total },
            moeda: p.currency,
            urlDaCapa: await urlDaCapaDe(secoes),
        })

        return NextResponse.json({
            html,
            congelada: congeladas.success && congeladas.data.length > 0,
            /**
             * **A folha do cliente, e não só o miolo.**
             *
             * O editor mostrava apenas o HTML do documento, solto no painel. O
             * cliente recebe isso dentro de uma folha: logo da organização,
             * rótulo e número, nome da organização, total, e a largura de
             * leitura. Sem esses dados o "Visualizar" não era o que o André
             * pediu — ele via o miolo e o cliente via a página.
             *
             * Quem desenha é `FolhaDoDocumento`, o **mesmo** componente da
             * página pública. Dois desenhos divergiriam, que é o argumento que
             * este módulo já faz para o render.
             */
            cabecalho: {
                logo: p.workspace.logo ?? null,
                rotulo: ROTULO_DO_TIPO[p.kind as TipoDeDocumento],
                numero: p.number,
                organizacao: p.workspace.name,
                totalEmTexto: dinheiroEmTexto(r.total, p.currency),
            },
            /** Cabeçalho e rodapé de impressão. Fora do `html`, como na página. */
            chrome: chromeDoDocumento({
                logo: p.workspace.logo ?? null,
                tema: p.template?.theme ?? null,
                rotuloCorrido: `${ROTULO_DO_TIPO[p.kind as TipoDeDocumento]} · ${p.deal?.contact?.name ?? p.workspace.name}`,
                rodapeCorrido: p.workspace.name,
            }),
            /**
             * **O tema inteiro, não a cor.** O editor tem de pintar a prévia
             * exatamente como a página do cliente pinta, e desde 27/11/2026 a
             * identidade é paleta, fonte e capa — não um campo `cor`.
             *
             * Enquanto isto devolvia só `theme.cor`, o modelo Estúdio (que
             * guarda `acentos`) chegava ao editor como **nulo**: a prévia caía
             * no tema do app, sem acento, sem fonte e sem capa escura, enquanto
             * o cliente via o documento desenhado. Era a divergência que a v2
             * existe para fechar, e ela voltou pela porta dos fundos.
             */
            tema: p.template?.theme ?? null,
            // Mantida para quem ainda leia o campo antigo.
            cor: (p.template?.theme as { cor?: string | null } | null)?.cor ?? null,
        })
    } catch (error) {
        console.error('[PROPOSTA_PREVIA]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
