import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { currentMembership } from '@venn/core/lib/auth/workspace'
import { revisaoVisivel } from '@venn/core/lib/propostas/acesso'
import {
    criarLink,
    VALIDADE_MAXIMA_EM_DIAS,
    VALIDADE_PADRAO_EM_DIAS,
} from '@venn/core/lib/propostas/compartilhar'
import {
    conversaAberta,
    enviarPorEmail,
    enviarPorWhatsApp,
    mensagemDeWhatsApp,
} from '@venn/core/lib/propostas/enviar'
import { ehTipoDeDocumento, podeTransicionar } from '@venn/core/lib/propostas/estados'
import { congelarVariaveis, contextoDeVariaveis } from '@venn/core/lib/propostas/contexto'
import { converterCorpoEmSecoes, secoesPadrao, secoesSchema } from '@venn/core/lib/propostas/secoes'
import { negocioAprendeComEnvio } from '@venn/core/lib/propostas/funil'
import { registrarEnvioNaConversa } from '@venn/core/lib/propostas/conversa'

/**
 * Gera o link público e, opcionalmente, o manda ao cliente.
 *
 * ## O link é o entregável; o envio é conveniência
 *
 * Mesmo que o e-mail falhe e não haja conversa aberta no WhatsApp, a resposta
 * traz o link — e o vendedor o copia e manda por onde quiser. O contrário
 * (falhar tudo porque o canal caiu) jogaria fora um token válido e deixaria a
 * revisão num estado em que ela foi marcada como enviada sem link nenhum.
 *
 * ## Dois canais, dois comportamentos
 *
 * E-mail sai sempre que houver endereço. WhatsApp **só dentro da janela de
 * 24 h** de uma conversa ativa: disparo frio está bloqueado por construção
 * neste projeto, e a resposta diz o motivo em vez de falhar calada. Ver a nota
 * de `lib/propostas/enviar.ts`.
 */

const enviarSchema = z.object({
    /**
     * Obrigatório no banco; aqui tem padrão e **teto**. Sem teto, a tela
     * acabaria oferecendo "não expira", contornando pela interface a decisão de
     * `expiresAt` ser obrigatório.
     */
    validadeEmDias: z.number().int().min(1).max(VALIDADE_MAXIMA_EM_DIAS).default(VALIDADE_PADRAO_EM_DIAS),
    porEmail: z.boolean().default(false),
    porWhatsApp: z.boolean().default(false),
    /** Outro destinatário que não o e-mail do contato. */
    email: z.string().email().optional(),
})

function versaoDaUrl(valor: string): number | null {
    const n = Number(valor)
    return Number.isInteger(n) && n >= 1 ? n : null
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; versao: string }> }
) {
    try {
        const { id, versao } = await params
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const writable = await requireWritable(membro.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

        const v = versaoDaUrl(versao)
        if (v === null) {
            return NextResponse.json({ error: 'Versão inválida' }, { status: 400 })
        }

        const revisao = await revisaoVisivel(membro, id, v)
        if (!revisao) {
            return NextResponse.json({ error: 'Revisão não encontrada' }, { status: 404 })
        }

        const dados = enviarSchema.parse(await request.json().catch(() => ({})))

        /**
         * A transição é verificada aqui, e **enviada → enviada** é permitida de
         * propósito pelo caminho de reenvio abaixo: mandar o link de novo (com
         * token novo, porque o anterior pode ter ido ao destinatário errado) é
         * operação legítima e frequente.
         *
         * O que não se permite é enviar o que já foi aceito, recusado ou
         * expirado: ali a saída é uma revisão nova.
         */
        const jaEnviada = revisao.status === 'enviada'
        if (!jaEnviada && !podeTransicionar(revisao.status, 'enviada')) {
            return NextResponse.json(
                {
                    error: 'Esta versão não pode ser enviada no estado em que está.',
                    status: revisao.status,
                },
                { status: 409 }
            )
        }

        const contexto = await prisma.proposalRevision.findUnique({
            where: { id: revisao.id },
            select: {
                subtotal: true,
                discount: true,
                total: true,
                validUntil: true,
                notes: true,
                sections: true,
                variableValues: true,
                items: { select: { id: true }, take: 1 },
                proposal: {
                    select: {
                        kind: true,
                        title: true,
                        number: true,
                        currency: true,
                        createdAt: true,
                        template: { select: { body: true, sections: true } },
                        workspace: { select: { name: true, cnpj: true, address: true, phone: true } },
                        createdBy: { select: { name: true, email: true, phone: true } },
                        deal: {
                            select: {
                                id: true,
                                title: true,
                                value: true,
                                createdAt: true,
                                stage: { select: { name: true } },
                                contact: { select: { id: true, name: true, email: true, phone: true, customFields: true } },
                            },
                        },
                    },
                },
            },
        })

        if (!contexto) {
            return NextResponse.json({ error: 'Revisão não encontrada' }, { status: 404 })
        }

        /**
         * Documento sem item não vai ao cliente.
         *
         * Não é regra inventada: um link que abre numa tabela vazia e num total
         * de zero é pior que nenhum link — o cliente conclui que a empresa é
         * desorganizada, e o vendedor só descobre quando ele não responde.
         */
        if (contexto.items.length === 0) {
            return NextResponse.json(
                { error: 'Acrescente pelo menos um item antes de enviar.' },
                { status: 409 }
            )
        }

        const tipo = ehTipoDeDocumento(contexto.proposal.kind) ? contexto.proposal.kind : 'proposta'
        const organizacao = contexto.proposal.workspace.name

        /**
         * Reenviar REVOGA o link anterior.
         *
         * O caso que isto fecha é o do destinatário errado: o vendedor manda,
         * percebe, e reenvia. Se o antigo continuasse valendo, o reenvio não
         * teria consertado nada — a pessoa errada continuaria com um link que
         * abre.
         */
        await prisma.proposalShare.updateMany({
            where: { revisionId: revisao.id, revokedAt: null, acceptedAt: null },
            data: { revokedAt: new Date() },
        })

        const link = await criarLink(revisao.id, membro.userId, dados.validadeEmDias)

        /**
         * O envio **congela** o documento: seções e valores das variáveis.
         *
         * "Revisão, não edição" valia para os itens desde a v1; a v2 estende ao
         * texto e aos dados. Mudar o modelo amanhã, ou o telefone do cliente,
         * não muda a proposta que ele tem na mão — e o hash do aceite continua
         * correspondendo ao que ele leu.
         *
         * Só na primeira ida: reenviar (link novo) não recongela, senão o
         * cliente que guardou o primeiro link e o que recebeu o segundo
         * leriam textos diferentes da mesma versão.
         */
        const faltamSecoes = !contexto.sections
        const faltamValores = !contexto.variableValues
        if (!jaEnviada || faltamSecoes || faltamValores) {
            const p = contexto.proposal
            const doModelo = secoesSchema.safeParse(p.template?.sections)
            const secoes =
                doModelo.success && doModelo.data.length > 0
                    ? doModelo.data
                    : (() => {
                          const c = converterCorpoEmSecoes(p.template?.body)
                          return c.length > 0 ? c : secoesPadrao()
                      })()
            const valores = congelarVariaveis(
                contextoDeVariaveis({
                    contato: p.deal.contact,
                    organizacao: p.workspace,
                    documento: {
                        kind: p.kind,
                        number: p.number,
                        title: p.title,
                        createdAt: p.createdAt,
                        validUntil: contexto.validUntil,
                        subtotal: contexto.subtotal,
                        discount: contexto.discount,
                        total: contexto.total,
                        moeda: p.currency,
                        // A observação é interna e não vai ao cliente: congela
                        // nula, para a página pública nunca a ter.
                        observacao: null,
                    },
                    negocio: {
                        title: p.deal.title,
                        value: p.deal.value,
                        stageName: p.deal.stage?.name ?? null,
                        createdAt: p.deal.createdAt,
                    },
                    responsavel: p.createdBy,
                })
            )
            await prisma.proposalRevision.update({
                where: { id: revisao.id },
                data: {
                    ...(jaEnviada ? {} : { status: 'enviada' }),
                    // Seções: só se a revisão não tiver as suas (rascunho de antes
                    // da F0). Valores: só na primeira vez — reenviar não recongela.
                    ...(faltamSecoes ? { sections: secoes } : {}),
                    ...(faltamValores ? { variableValues: valores } : {}),
                },
            })
        }

        /**
         * O negócio aprende com o envio: o valor é o total desta versão, e a
         * etapa anda para "proposta enviada" quando a organização marcou uma
         * — só para a frente (ver `lib/propostas/funil.ts`). Em toda ida,
         * inclusive reenvio: o valor do negócio é o da última versão na mão do
         * cliente.
         */
        await prisma.$transaction((tx) =>
            negocioAprendeComEnvio(tx, {
                dealId: contexto.proposal.deal.id,
                total: contexto.total,
                kind: contexto.proposal.kind,
                numero: contexto.proposal.number,
            })
        )

        // ── os canais ───────────────────────────────────────────────────────

        const envios: { canal: 'email' | 'whatsapp'; ok: boolean; motivo?: string }[] = []

        if (dados.porEmail) {
            const para = dados.email ?? contexto.proposal.deal.contact?.email ?? null
            if (!para) {
                envios.push({ canal: 'email', ok: false, motivo: 'este contato não tem e-mail cadastrado' })
            } else {
                const r = await enviarPorEmail({
                    para,
                    tipo,
                    numero: contexto.proposal.number,
                    titulo: contexto.proposal.title,
                    url: link.url,
                    organizacao,
                    validade: link.expiresAt,
                    responsavel: contexto.proposal.createdBy?.name ?? null,
                })
                envios.push({ canal: 'email', ok: r.ok, motivo: r.error })
                // O envio consta em Conversas, no fio do documento. Só o que saiu:
                // um e-mail que falhou não vira registro de envio.
                if (r.ok && contexto.proposal.deal.contact?.id) {
                    await registrarEnvioNaConversa({
                        workspaceId: membro.workspaceId,
                        contactId: contexto.proposal.deal.contact.id,
                        userId: membro.userId,
                        kind: contexto.proposal.kind,
                        numero: contexto.proposal.number,
                        para,
                        url: link.url,
                    })
                }
            }
        }

        if (dados.porWhatsApp) {
            const contactId = contexto.proposal.deal.contact?.id
            const conversa = contactId ? await conversaAberta(membro.workspaceId, contactId) : null
            if (!conversa) {
                envios.push({
                    canal: 'whatsapp',
                    ok: false,
                    // A mensagem explica a regra, porque ela não é óbvia: o
                    // vendedor vê o número do contato na ficha e espera poder
                    // mandar. A janela de 24 h é da Meta, não nossa.
                    motivo:
                        'não há conversa ativa no WhatsApp com este contato nas últimas 24 horas — ' +
                        'fora dessa janela o envio é recusado pelo provedor',
                })
            } else {
                const texto = mensagemDeWhatsApp(tipo, contexto.proposal.number, link.url, organizacao)
                const r = await enviarPorWhatsApp(conversa, texto, membro.userId)
                envios.push({ canal: 'whatsapp', ok: r.ok, motivo: r.motivo })
            }
        }

        return NextResponse.json({
            shareId: link.shareId,
            // O link em claro na resposta: "copiar o link" é a ação principal
            // desta tela. Ver a nota de `lib/propostas/compartilhar.ts` sobre
            // por que o token não é guardado em resumo como o do convite.
            url: link.url,
            expiresAt: link.expiresAt,
            status: 'enviada',
            envios,
        })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[PROPOSTA_ENVIAR_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
