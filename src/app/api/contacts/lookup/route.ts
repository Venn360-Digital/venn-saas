import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { contactScope, getWorkspaceMember } from '@/lib/auth/workspace'
import { connectedWhatsApp, formatPhone, hasWhatsApp, normalizePhone, phoneVariants } from '@/lib/intake'

/**
 * Quem é este número, antes de gravar qualquer coisa.
 *
 * Responde três perguntas de uma vez, porque é o que a tela precisa saber antes
 * de deixar criar: o número é plausível, já existe paciente com ele, e ele tem
 * WhatsApp. A ordem importa — um paciente já cadastrado dispensa a verificação
 * no provedor, e descobrir isso primeiro evita uma chamada de rede por tecla.
 *
 * Nada é criado aqui. É o que impede um dígito trocado de virar paciente,
 * negócio e cartão no funil para um número que nunca vai receber mensagem.
 */
export async function GET(request: NextRequest) {
    try {
        return await lookup(request)
    } catch (error) {
        // Sem isto o handler quebrado devolvia uma falha opaca, e a tela traduzia
        // qualquer falha como "número incompleto" — a mensagem errada para a
        // causa errada.
        console.error('[CONTACT_LOOKUP] falhou:', error)
        return NextResponse.json({ error: 'Não foi possível verificar o número' }, { status: 500 })
    }
}

async function lookup(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const raw = new URL(request.url).searchParams.get('phone') ?? ''
    const { digits, valid } = normalizePhone(raw)

    /** Só os quatro últimos no log: dá para correlacionar sem despejar o número. */
    const tail = digits.slice(-4)

    if (!valid) {
        console.log(`[CONTACT_LOOKUP] ****${tail} (${digits.length} dígitos) inválido`)
        return NextResponse.json({ valid: false, phone: digits, formatted: formatPhone(digits) })
    }

    // As duas formas, porque o nono dígito separa a ficha criada à mão da que
    // o WhatsApp cria — e as duas são a mesma pessoa.
    const variants = phoneVariants(digits)
    const contact = await prisma.contact.findFirst({
        where: { workspaceId: auth.member.workspaceId, phone: { in: variants } },
        select: { id: true, name: true, phone: true },
    })

    /**
     * O paciente existe **e é da fila de quem perguntou**?
     *
     * ## Por que a conferência é separada da busca
     *
     * A busca acima **não** leva `contactScope`, e isso é deliberado. Esta rota
     * existe para impedir ficha duplicada: se o recorte escondesse o paciente
     * do atendente, ele criaria uma segunda ficha para o mesmo número — e o
     * índice único do telefone ou recusaria a gravação, ou o paciente ficaria
     * partido em duas. O conserto óbvio quebraria a função da rota.
     *
     * ## O que estava errado, então
     *
     * A resposta devolvia `name`, o negócio e a fase para **qualquer** membro
     * da clínica. Era um oráculo: digite um telefone e descubra se é paciente
     * daqui e como ele se chama, mesmo estando fora da sua fila. Todas as
     * irmãs — `contacts` GET, `contacts/[id]`, `contacts/export` — aplicam
     * `contactScope`; esta tinha ficado de fora.
     *
     * ## O recorte certo
     *
     * A **existência** continua visível, porque é ela que evita a duplicata. A
     * **identidade** não: sem nome, sem negócio, sem fase, sem conversa. A tela
     * já cai em "Paciente cadastrado já está na base" quando o nome falta, sem
     * precisar mudar.
     *
     * `contactId` continua indo. É cuid opaco, não revela nada sozinho, e é o
     * que permite o atendimento novo se prender à ficha certa em vez de abrir
     * outra. E ao assumir esse atendimento ele passa a ser dele, logo o recorte
     * passa a incluí-lo — que é como o produto já funciona.
     */
    const daMinhaFila = contact
        ? (await prisma.contact.findFirst({
              where: {
                  id: contact.id,
                  workspaceId: auth.member.workspaceId,
                  ...contactScope(auth.member),
              },
              select: { id: true },
          })) !== null
        : false

    let existing = null
    if (contact && !daMinhaFila) {
        existing = {
            contactId: contact.id,
            name: null,
            dealId: null,
            stageName: null,
            conversationId: null,
            lastMessageAt: null,
        }
    } else if (contact) {
        const [deal, conversation] = await Promise.all([
            prisma.deal.findFirst({
                where: { workspaceId: auth.member.workspaceId, contactId: contact.id, status: 'open' },
                orderBy: { createdAt: 'desc' },
                select: { id: true, title: true, stage: { select: { name: true } } },
            }),
            prisma.conversation.findFirst({
                where: { workspaceId: auth.member.workspaceId, contactId: contact.id },
                orderBy: [{ status: 'asc' }, { lastMessageAt: 'desc' }],
                select: { id: true, status: true, lastMessageAt: true },
            }),
        ])
        existing = {
            contactId: contact.id,
            name: contact.name,
            dealId: deal?.id ?? null,
            stageName: deal?.stage?.name ?? null,
            conversationId: conversation?.id ?? null,
            lastMessageAt: conversation?.lastMessageAt ?? null,
        }
    }

    /**
     * Paciente conhecido já provou que o número existe: a conversa só existe
     * porque alguém escreveu por ela.
     *
     * `daMinhaFila` e não `existing?.conversationId`, desde o recorte acima: a
     * resposta reduzida não carrega a conversa, e usar o campo faria o atalho
     * deixar de valer para quem está fora da fila — uma ida ao provedor por
     * tecla digitada, para uma pergunta cuja resposta já estava no banco.
     * A conversa existir é fato da clínica, não da fila de quem pergunta.
     */
    const temConversa = daMinhaFila
        ? Boolean(existing?.conversationId)
        : contact !== null &&
          (await prisma.conversation.count({
              where: { workspaceId: auth.member.workspaceId, contactId: contact.id },
          })) > 0

    const checked = temConversa
        ? { exists: true as boolean | undefined, canonical: contact?.phone ?? null }
        : await hasWhatsApp(auth.member.workspaceId, digits)

    /**
     * A forma que será gravada.
     *
     * Ordem de autoridade: o JID que o WhatsApp devolveu, depois a ficha que já
     * existe, depois o que foi digitado. É o que garante que a mensagem que
     * chegar amanhã caia nesta ficha em vez de abrir uma segunda.
     */
    const canonical = checked.canonical ?? contact?.phone ?? digits

    const channel = await connectedWhatsApp(auth.member.workspaceId)

    console.log(
        `[CONTACT_LOOKUP] ****${tail} variantes=${phoneVariants(digits).length} ` +
        `ficha=${existing ? 'sim' : 'não'} whatsapp=${String(checked.exists)} ` +
        `canônico=****${canonical.slice(-4)} canal=${channel ? 'conectado' : 'nenhum'}`
    )

    return NextResponse.json({
        valid: true,
        phone: canonical,
        typed: digits,
        formatted: formatPhone(canonical),
        existing,
        /** `true` tem, `false` não tem, `null` não deu para verificar. */
        whatsapp: checked.exists ?? null,
        /** Sem canal conectado não há como abrir conversa — só registrar. */
        channelConnected: Boolean(channel),
    })
}
