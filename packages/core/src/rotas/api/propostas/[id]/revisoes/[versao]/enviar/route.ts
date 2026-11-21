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
                total: true,
                items: { select: { id: true }, take: 1 },
                proposal: {
                    select: {
                        kind: true,
                        title: true,
                        number: true,
                        workspace: { select: { name: true } },
                        createdBy: { select: { name: true } },
                        deal: {
                            select: {
                                contact: { select: { id: true, name: true, email: true } },
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

        if (!jaEnviada) {
            await prisma.proposalRevision.update({
                where: { id: revisao.id },
                data: { status: 'enviada' },
            })
        }

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
