import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import type { Prisma } from '@venn/db'
import { widgetCors } from '@venn/core/lib/widget'
import { dentroDoLimite, ipDaRequisicao } from '@venn/core/lib/limite'
import { phoneVariants } from '@venn/core/lib/whatsapp/types'
import { contatoCriado, etiquetasAplicadas } from '@venn/core/lib/funil/disparos'
import { proximoResponsavel } from '@venn/core/lib/conversas/dono'
import { iniciarConversaDoLead } from '@venn/core/lib/formularios/conversa'
import { primeiraFaseDoPadrao } from '@venn/core/lib/pipeline/funis'
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
 * O envio sempre fica registrado. O resto são três interruptores do
 * formulário, e eles pendem um do outro:
 *
 * - **criar contato**: a ficha (nova, ou a existente completada no que
 *   faltava — telefone é a chave, como em todo o produto) e as etiquetas.
 *   Desligado, nada mais acontece: negócio e conversa pendem da ficha. A
 *   etiqueta **nova** para a ficha liga funil de marketing; é assim que o lead
 *   deste formulário entra em nutrição, e é o cliente que escolhe, marcando a
 *   etiqueta aqui.
 * - **iniciar conversa**: o fio no atendimento, quando há WhatsApp válido e
 *   linha conectada — com a saudação do agente no QR e sem envio no canal
 *   oficial da Meta. Ver `iniciarConversaDoLead`.
 * - **criar negócio**: na primeira fase do funil padrão, com o resumo das
 *   respostas nas observações.
 *
 * **O responsável sai da regra de distribuição da conta** (rodízio ou
 * balanceado, respeitando "só disponíveis"), nunca de um nome fixo no
 * formulário: é a mesma política das conversas, e PRODUCT.md §17 registra por
 * quê. Os funis de marketing entram no fim: a ficha nova liga o de
 * boas-vindas, e a etiqueta nova liga o que escutar aquela etiqueta.
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

    const metadados = {
        ip,
        userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
        pageUrl:
            (typeof corpo._pagina === 'string' ? corpo._pagina : request.headers.get('referer'))?.slice(0, 500) ??
            null,
    }

    /**
     * **Sem "criar contato", o envio para aqui.**
     *
     * A ficha é o eixo: negócio e conversa pendem dela, então desligar o
     * contato desliga os dois. O envio continua gravado — é ele que o
     * formulário mostra, e o que a equipe tria depois.
     */
    if (!config.criarContato) {
        await prisma.leadFormSubmission.create({
            data: {
                workspaceId,
                formId: form.id,
                data: validado.valores as unknown as Prisma.InputJsonValue,
                ...metadados,
            },
        })
        return responder(
            {
                ok: true,
                mensagem: config.mensagemDeSucesso,
                redirecionarPara: config.redirecionarPara || null,
            },
            201
        )
    }

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
                // A mesma origem vai para a ficha **e** para o negócio, como
                // em todo caminho do produto (PRODUCT.md §10). Mídia não: ela
                // pende do negócio, e o formulário não a semeia.
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

    /**
     * As etiquetas do formulário — e **quais delas são novas para esta ficha**.
     *
     * A diferença importa porque a etiqueta aplicada liga funil de marketing
     * (ver o disparo no fim desta rota). "Aplicada" tem de querer dizer
     * aplicada: quem já tinha a etiqueta e preencheu o formulário de novo não
     * recebeu etiqueta nenhuma, e tratar isso como aplicação faria o funil de
     * nutrição recomeçar a cada visita — a trava de passagem ativa só segura
     * enquanto a passagem anterior não concluiu.
     *
     * A consulta extra sai só quando o formulário tem etiqueta configurada.
     */
    let etiquetasNovas: string[] = []
    if (config.tagIds.length) {
        const etiquetas = await prisma.tag.findMany({
            where: { workspaceId, id: { in: config.tagIds } },
            select: { id: true },
        })
        if (etiquetas.length) {
            const jaTinha = await prisma.contactTag.findMany({
                where: { contactId: contato.id, tagId: { in: etiquetas.map((t) => t.id) } },
                select: { tagId: true },
            })
            const dela = new Set(jaTinha.map((t) => t.tagId))
            etiquetasNovas = etiquetas.map((t) => t.id).filter((id) => !dela.has(id))

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
            ...metadados,
        },
    })

    /**
     * A conversa, quando há WhatsApp e linha — **e o que sai depende do canal**.
     *
     * Vem antes do negócio porque é ela que distribui: `darDono` aplica a
     * política da conta (rodízio ou balanceado, só disponíveis, departamento
     * da linha) e grava o responsável, e o negócio herda esse mesmo dono — é a
     * regra que o produto já tinha para o lead que escreve primeiro ("no
     * negócio que nasce da primeira mensagem o dono é quem assume a
     * conversa", PRODUCT.md §11).
     *
     * A diferença entre os canais não é escolha nossa: no QR dá para falar com
     * quem nunca escreveu, no oficial da Meta não — fora da janela de 24h
     * aquilo exige template aprovado, que o projeto não tem (PRODUCT.md §8).
     * Então o QR recebe a saudação do agente e a IA conduz; o oficial abre a
     * conversa com o resumo em nota interna, para a equipe, sem enviar nada.
     */
    const inicio = config.iniciarConversa
        ? await iniciarConversaDoLead({
              workspaceId,
              contato: { id: contato.id, phone: contato.phone },
              formulario: { id: form.id, name: form.name },
              resumo,
          })
        : null

    /**
     * O negócio, no funil padrão — o mesmo em que a primeira mensagem criaria.
     *
     * **Sem a regra "um por funil" aqui**, por decisão do Andre em
     * 20/11/2026: quem preencheu o formulário de novo pediu outra coisa, e
     * perder o lead porque a pessoa já tinha um negócio aberto era o oposto de
     * captar. Quem governa o lead é a regra de distribuição. Ver PRODUCT.md
     * §17 e a implicação registrada lá (o cartão da conversa e o agente leem o
     * negócio aberto **mais recente**).
     */
    if (config.criarNegocio) {
        const fase = await primeiraFaseDoPadrao(workspaceId)
        if (fase) {
            // O dono da conversa, quando ela nasceu; senão a mesma escolha,
            // feita sem conversa — é o caso de quem deixou só o e-mail.
            const responsavel =
                inicio?.responsavel ?? (await proximoResponsavel(workspaceId, inicio?.integrationId ?? null))
            await prisma.deal.create({
                data: {
                    workspaceId,
                    contactId: contato.id,
                    title: contato.name || lead.nome || lead.telefone || lead.email || `Lead — ${form.name}`,
                    stageId: fase.id,
                    userId: responsavel,
                    originId: form.originId,
                    notes: `Formulário "${form.name}"\n${resumo}`.slice(0, 4000),
                    status: 'open',
                    // `userId` nulo na passagem: foi o formulário, não uma pessoa.
                    stageEntries: { create: { stageId: fase.id } },
                },
            })
        }
    }

    /**
     * Os funis de marketing, **no fim e nesta ordem**.
     *
     * Depois da ficha, do envio, da conversa e do negócio de propósito: um
     * passo de condição ("tem negócio aberto?", "tem etiqueta?") lê o banco no
     * instante em que a passagem começa, e disparar antes deixaria o funil
     * decidindo sobre um lead pela metade.
     *
     * São dois fatos diferentes e podem ligar funis diferentes:
     *
     * - **ficha nova** (`contato_criado`), que é o funil de boas-vindas;
     * - **etiqueta aplicada** (`etiqueta_aplicada`), decisão do Andre em
     *   20/11/2026 sobre como o lead de formulário entra em funil. É o caminho
     *   mais controlado — quem escolhe é o cliente, marcando a etiqueta no
     *   formulário — e o único que também pega **quem já era contato**: a ficha
     *   só é nova uma vez, e o lead que volta pedindo outra coisa é justamente
     *   quem se quer nutrir. Vale em especial para quem deixou só o e-mail, que
     *   é quem o WhatsApp não alcança.
     *
     * Antes disto as etiquetas do formulário eram gravadas direto e o gatilho
     * nunca acendia: o funil ficava publicado e ninguém entrava por ali, que é
     * a falha silenciosa que `check:gatilhos` existe para evitar.
     */
    if (novo) await contatoCriado(workspaceId, contato.id)
    if (etiquetasNovas.length) await etiquetasAplicadas(workspaceId, contato.id, etiquetasNovas)

    return responder(
        {
            ok: true,
            mensagem: config.mensagemDeSucesso,
            redirecionarPara: config.redirecionarPara || null,
        },
        201
    )
}
