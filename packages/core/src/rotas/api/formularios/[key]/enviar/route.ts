import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import type { Prisma } from '@venn/db'
import { widgetCors } from '@venn/core/lib/widget'
import { dentroDoLimite, ipDaRequisicao } from '@venn/core/lib/limite'
import { phoneVariants } from '@venn/core/lib/whatsapp/types'
import { contatoCriado } from '@venn/core/lib/funil/disparos'
import { negocioAbertoNoFunil, primeiraFaseDoPadrao } from '@venn/core/lib/pipeline/funis'
import {
    extrairContato,
    lerCampos,
    lerConfiguracao,
    resumoDasRespostas,
    validarEnvio,
} from '@venn/core/lib/formularios/schema'

/**
 * O envio de um formulário de captura — a porta pública.
 *
 * Quem chama é um visitante do site da organização, sem login. A chave na URL
 * identifica o formulário e **não autoriza nada além de enviar**: a resposta
 * nunca devolve dado de ninguém.
 *
 * ## As defesas, em ordem
 *
 * 1. Só formulário publicado responde.
 * 2. Dois tetos por hora (por IP apertado, por formulário folgado), em banco —
 *    no Worker um `Map` vive por isolate e não conta nada (ver `lib/limite`).
 * 3. Campo-armadilha (`_hp`): robô que preenche o campo invisível recebe
 *    "ok" e nada é gravado. Não devolve erro de propósito — erro ensina o
 *    robô a desviar.
 * 4. A validação é a mesma da página (`validarEnvio`), aplicada de novo aqui:
 *    o que chega do navegador de um desconhecido não é o que a página mandou.
 *
 * ## O que um envio produz
 *
 * A ficha (nova, ou a existente completada no que faltava — telefone é a
 * chave, como em todo o produto), as etiquetas do formulário, o registro do
 * envio com as respostas inteiras, e um negócio no funil **padrão** quando a
 * pessoa ainda não tem um lá — com o resumo das respostas nas observações e
 * o responsável que o formulário indica. Ficha nova ainda pode ligar o funil
 * de boas-vindas (`contatoCriado`).
 */

export async function OPTIONS(request: NextRequest) {
    return new NextResponse(null, { status: 204, headers: widgetCors(request.headers.get('origin')) })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
    const { key } = await params
    const cors = widgetCors(request.headers.get('origin'))
    const responder = (corpo: unknown, status = 200) => NextResponse.json(corpo, { status, headers: cors })

    if (!key || key.length < 16) return responder({ error: 'Formulário indisponível' }, 404)

    const form = await prisma.leadForm.findFirst({
        where: { publicKey: key, status: 'published' },
        select: {
            id: true,
            workspaceId: true,
            name: true,
            fields: true,
            settings: true,
            originId: true,
            assignedUserId: true,
        },
    })
    if (!form) return responder({ error: 'Formulário indisponível' }, 404)

    const ip = ipDaRequisicao(request)
    const [ipOk, formOk] = await Promise.all([
        dentroDoLimite(`form:${key}:${ip}`, 10, 3600),
        dentroDoLimite(`form:${key}`, 300, 3600),
    ])
    if (!ipOk || !formOk) {
        return responder({ error: 'Muitos envios em pouco tempo. Tente de novo em alguns minutos.' }, 429)
    }

    const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!corpo || typeof corpo !== 'object') return responder({ error: 'Envio inválido' }, 400)

    // O campo-armadilha. Preenchido, finge sucesso e grava nada.
    if (typeof corpo._hp === 'string' && corpo._hp.trim()) return responder({ ok: true })

    const dados = (corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : corpo) as Record<string, unknown>
    const campos = lerCampos(form.fields)
    const config = lerConfiguracao(form.settings)

    const validado = validarEnvio(campos, dados)
    if (!validado.ok) return responder({ erros: validado.erros }, 400)

    const lead = extrairContato(campos, validado.valores)
    const resumo = resumoDasRespostas(campos, validado.valores)
    const workspaceId = form.workspaceId

    /**
     * A ficha. Pelo telefone primeiro — as duas formas do celular brasileiro
     * são a mesma pessoa —, pelo e-mail se não houver telefone. Existindo,
     * completa só o que falta: o que a pessoa escreveu no site não reescreve o
     * que a equipe já corrigiu na ficha.
     */
    const selecao = { id: true, name: true, phone: true, email: true, notes: true } as const
    let contato = lead.telefone
        ? await prisma.contact.findFirst({
              where: { workspaceId, phone: { in: phoneVariants(lead.telefone) } },
              select: selecao,
          })
        : null
    if (!contato && lead.email) {
        contato = await prisma.contact.findFirst({
            where: { workspaceId, email: { equals: lead.email, mode: 'insensitive' } },
            select: selecao,
        })
    }

    let novo = false
    if (!contato) {
        contato = await prisma.contact.create({
            data: {
                workspaceId,
                name: lead.nome ?? null,
                phone: lead.telefone ?? null,
                email: lead.email ?? null,
                notes: lead.observacoes ?? null,
                createdVia: 'formulario',
                originId: form.originId,
                lastContactAt: new Date(),
            },
            select: selecao,
        })
        novo = true
    } else {
        const faltando: Prisma.ContactUpdateInput = {
            ...(lead.nome && !contato.name ? { name: lead.nome } : {}),
            ...(lead.email && !contato.email ? { email: lead.email } : {}),
            ...(lead.telefone && !contato.phone ? { phone: lead.telefone } : {}),
            ...(lead.observacoes
                ? { notes: [contato.notes, lead.observacoes].filter(Boolean).join('\n\n') }
                : {}),
            lastContactAt: new Date(),
        }
        try {
            await prisma.contact.update({ where: { id: contato.id }, data: faltando })
        } catch {
            // O índice único pode recusar o telefone (já é de outra ficha); a
            // ficha fica como está e o envio segue.
        }
    }

    if (config.tagIds.length) {
        const etiquetas = await prisma.tag.findMany({
            where: { workspaceId, id: { in: config.tagIds } },
            select: { id: true },
        })
        if (etiquetas.length) {
            await prisma.contactTag.createMany({
                data: etiquetas.map((t) => ({ contactId: contato!.id, tagId: t.id })),
                skipDuplicates: true,
            })
        }
    }

    await prisma.leadFormSubmission.create({
        data: {
            workspaceId,
            formId: form.id,
            contactId: contato.id,
            data: validado.valores as unknown as Prisma.InputJsonValue,
            ip,
            userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
            pageUrl:
                (typeof corpo._pagina === 'string' ? corpo._pagina : request.headers.get('referer'))?.slice(0, 500) ??
                null,
        },
    })

    /**
     * O negócio, no funil padrão — o mesmo em que a primeira mensagem criaria.
     * Um por pessoa por funil (PRODUCT.md §15): quem já tem negócio aberto lá
     * não ganha outro; o envio fica registrado e as observações da ficha
     * guardam as respostas.
     */
    if (config.criarNegocio) {
        const fase = await primeiraFaseDoPadrao(workspaceId)
        if (fase && !(await negocioAbertoNoFunil(workspaceId, contato.id, fase.pipelineId))) {
            await prisma.deal.create({
                data: {
                    workspaceId,
                    contactId: contato.id,
                    title: contato.name || lead.nome || lead.telefone || lead.email || `Lead — ${form.name}`,
                    stageId: fase.id,
                    userId: form.assignedUserId,
                    originId: form.originId,
                    notes: `Formulário "${form.name}"\n${resumo}`.slice(0, 4000),
                    status: 'open',
                    // `userId` nulo na passagem: foi o formulário, não uma pessoa.
                    stageEntries: { create: { stageId: fase.id } },
                },
            })
        }
    }

    if (novo) await contatoCriado(workspaceId, contato.id)

    return responder(
        {
            ok: true,
            mensagem: config.mensagemDeSucesso,
            redirecionarPara: config.redirecionarPara || null,
        },
        201
    )
}
