import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { ipDaRequisicao } from '@venn/core/lib/limite'
import { documentoPublico, hashDoConteudo } from '@venn/core/lib/propostas/compartilhar'
import {
    dentroDoLimitePublico,
    pareceToken,
    renderizarPublico,
    secoesDoCompartilhamento,
    userAgentDaRequisicao,
} from '@venn/core/lib/propostas/publico'
import { urlDaCapaDe } from '@venn/core/lib/propostas/capa'
import { aceitarDocumento } from '@venn/core/lib/propostas/aceite'

/**
 * O aceite do cliente — sem autenticação, e o ato mais consequente do módulo.
 *
 * ## A mesma 404 de sempre
 *
 * Token inexistente, expirado e revogado respondem igual, como na página. Aqui
 * ainda mais importante: um 403 "este link foi revogado" diria a quem varre que
 * o token existia.
 *
 * ## Aceitar duas vezes devolve 409 com o carimbo ORIGINAL
 *
 * O caso é o duplo clique, e o desfecho certo não é um erro: é dizer "já está
 * aceito, desde tal hora". A tela mostra o aceite em vez de uma falha — a
 * pessoa conseguiu o que queria. Sobrescrever o carimbo seria pior: apagaria a
 * hora real do ato.
 *
 * ## O total que o cliente mandar é ignorado
 *
 * O corpo aceita **só o nome**. Não há campo de valor, de item nem de desconto:
 * o que ele aceita é o que está gravado, e o servidor nem oferece o caminho
 * para discordar.
 */

const aceiteSchema = z.object({
    nome: z
        .string()
        .trim()
        .min(3, 'Escreva o seu nome completo')
        .max(200),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    try {
        const { token } = await params

        if (!pareceToken(token)) {
            return NextResponse.json({ error: 'Documento indisponível' }, { status: 404 })
        }

        /**
         * Rate limit apertado: dez tentativas por IP por hora.
         *
         * Aceitar é ato único. Um teto generoso aqui permitiria usar a rota como
         * oráculo de existência de token, uma tentativa por vez, por horas.
         */
        if (!(await dentroDoLimitePublico(request, token, 'aceitar'))) {
            return NextResponse.json({ error: 'Muitas tentativas. Tente mais tarde.' }, { status: 429 })
        }

        const dados = aceiteSchema.parse(await request.json())

        const share = await documentoPublico(token)
        if (!share) {
            return NextResponse.json({ error: 'Documento indisponível' }, { status: 404 })
        }

        // Já aceito: 409 com o carimbo original. Ver o cabeçalho.
        if (share.acceptedAt) {
            return NextResponse.json(
                {
                    error: 'Este documento já foi aceito.',
                    acceptedAt: share.acceptedAt,
                    acceptedByName: share.acceptedByName,
                },
                { status: 409 }
            )
        }

        /**
         * O prazo comercial é verificado aqui, e é diferente da validade do link.
         *
         * `expiresAt` do link já foi testado em `documentoPublico`. Este é o
         * `validUntil` da revisão: a proposta pode valer 30 dias e o link ter
         * sido trocado três vezes nesse meio. Aceitar fora do prazo comercial
         * comprometeria um preço que a unidade não garante mais.
         */
        if (share.revision.validUntil && share.revision.validUntil < new Date()) {
            return NextResponse.json(
                { error: 'O prazo deste documento venceu. Peça uma versão atualizada.' },
                { status: 409 }
            )
        }

        if (share.revision.status !== 'enviada') {
            // Uma revisão que não está enviada não deveria ter link ativo. Se
            // chegou aqui, algo saiu de sincronia — e aceitar seria pior que
            // recusar.
            return NextResponse.json({ error: 'Documento indisponível' }, { status: 404 })
        }

        /**
         * O hash é do HTML que a pessoa tinha na tela.
         *
         * `renderizarPublico` é determinístico (nenhum `new Date()` lá dentro),
         * então o que se calcula aqui é byte a byte o que a página renderizou.
         * É o que permite responder, meses depois e com o template já alterado,
         * "o que exatamente ele aceitou".
         */
        const doc = renderizarPublico(share, await urlDaCapaDe(secoesDoCompartilhamento(share)))
        const contentHash = await hashDoConteudo(doc.html)

        const resultado = await aceitarDocumento({
            shareId: share.id,
            revisionId: share.revision.id,
            nome: dados.nome,
            ip: ipDaRequisicao(request),
            userAgent: userAgentDaRequisicao(request),
            contentHash,
        })

        if (!resultado.ok) {
            // A corrida: dois cliques simultâneos, e o segundo encontrou o
            // primeiro já gravado. Mesma resposta do já-aceito.
            return NextResponse.json(
                {
                    error: 'Este documento já foi aceito.',
                    acceptedAt: resultado.acceptedAt,
                    acceptedByName: resultado.acceptedByName,
                },
                { status: 409 }
            )
        }

        return NextResponse.json({
            acceptedAt: resultado.acceptedAt,
            acceptedByName: resultado.acceptedByName,
        })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[PROPOSTA_ACEITAR]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

/**
 * Sem GET.
 *
 * O aceite é efeito colateral, e um GET o deixaria disparar por pré-busca de
 * navegador, por scanner de link de WhatsApp, ou por quem cola o endereço
 * errado. Já aconteceu em produtos maiores que este.
 */
export async function GET() {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}
