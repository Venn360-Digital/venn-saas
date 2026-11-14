import 'server-only'
import prisma from '@venn/db/cliente'
import { BRAND } from '@venn/core/marca'
import {
    campanhaEmTexto,
    primeiroNome,
    renderCampanha,
    type CamposDaMesclagem,
} from '../email/blocos'
import { enviarPorSes } from '../email/ses'
import { urlDeDescadastro } from '../marketing/descadastro'
import { conteudoDoPasso, remetenteDoFunil, type Passagem } from './estado'

/** Mesma derivação de `servicos/broadcast.ts`: o host da marca quando não há env. */
/**
 * Preguiçoso de propósito, e isto é a diferença entre funcionar e ser refém da
 * ordem dos imports.
 *
 * Era `const APP_URL = … BRAND.appHost` no nível do módulo. Com a marca vinda
 * de um registro, um `const` aqui chamaria `BRAND()` no instante em que o
 * módulo é avaliado — ou seja, antes de `registrarBrand()` se o grafo de
 * imports mudar de ordem — e congelaria o valor para sempre. Resolver no ponto
 * de uso tira a leitura do caminho crítico do arranque.
 */
function appUrl(): string {
    return process.env.NEXT_PUBLIC_APP_URL ?? `https://${BRAND().appHost}`
}

/**
 * O que um passo de funil **faz**.
 *
 * ## Por que isto não reusa `src/lib/rules/executor.ts`
 *
 * O plano previa reaproveitar o executor de regras, que já tem etiquetar, mover
 * de etapa e atribuir escritos. Ao ler, não serve: o `RuleExecutor` trabalha
 * sobre um `RuleContext` com `conversationId` e canal — ele opera **dentro de
 * uma conversa viva**, e injeta o envio por `dispatchMessage` justamente porque
 * a mensagem é resposta a uma que chegou.
 *
 * O funil opera sobre **contato**, e o caso que mais importa é o contato sem
 * conversa aberta: paciente que não escreve há seis meses e entra num funil de
 * retorno. Reusar o executor obrigaria a fabricar um contexto de conversa para
 * uma conversa que não existe — e fabricar contexto para passar por uma
 * assinatura é o caminho curto para o passo escrever na conversa errada.
 *
 * Então as ações são próprias, escrevem o mesmo que o executor escreve, e cada
 * `where` leva `workspaceId`.
 */

export type ResultadoDaAcao =
    | { ok: true; detalhe?: string }
    /** Não deu, e repetir não ajuda: falta remetente, falta conteúdo, canal bloqueado. */
    | { ok: false; definitivo: true; motivo: string }
    /** Não deu agora: rede, limite do SES, 5xx. A instância tenta de novo. */
    | { ok: false; definitivo: false; motivo: string }

// ─────────────────────────────── Etiqueta ───────────────────────────────

export async function etiquetar(passagem: Passagem, config: unknown): Promise<ResultadoDaAcao> {
    const tagId = texto(config, 'tagId')
    if (!tagId) return { ok: false, definitivo: true, motivo: 'passo sem etiqueta escolhida' }

    /**
     * A etiqueta tem de ser **desta unidade**.
     *
     * O id vem do desenho do funil, que é dado que a tela escreve. Sem esta
     * conferência, um `tagId` de outra clínica — copiado por engano ao duplicar
     * um funil, ou editado no banco — criaria vínculo cruzando a fronteira do
     * workspace, e a etiqueta apareceria na ficha do paciente com o nome de
     * outra clínica.
     */
    const tag = await prisma.tag.findFirst({
        where: { id: tagId, workspaceId: passagem.workspaceId },
        select: { id: true },
    })
    if (!tag) return { ok: false, definitivo: true, motivo: 'a etiqueta não existe nesta unidade' }

    // `createMany` com `skipDuplicates`: a chave é composta, e aplicar duas
    // vezes a mesma etiqueta é repetição honesta, não erro.
    await prisma.contactTag.createMany({
        data: [{ contactId: passagem.contactId, tagId }],
        skipDuplicates: true,
    })

    return { ok: true }
}

// ──────────────────────────── Etapa do negócio ────────────────────────────

/**
 * Move o negócio aberto do contato para outra etapa.
 *
 * **Não cria negócio.** Um passo de funil que criasse negócio encheria o quadro
 * de vendas de cartões que ninguém pediu, e a dona da clínica veria a receita
 * prevista subir por conta de um automatismo. Sem negócio aberto, o passo passa
 * sem fazer nada e diz por quê.
 */
export async function moverEtapa(passagem: Passagem, config: unknown): Promise<ResultadoDaAcao> {
    const stageId = texto(config, 'stageId')
    if (!stageId) return { ok: false, definitivo: true, motivo: 'passo sem etapa escolhida' }

    const etapa = await prisma.pipelineStage.findFirst({
        where: { id: stageId, workspaceId: passagem.workspaceId },
        select: { id: true },
    })
    if (!etapa) return { ok: false, definitivo: true, motivo: 'a etapa não existe nesta unidade' }

    const movidos = await prisma.deal.updateMany({
        where: { workspaceId: passagem.workspaceId, contactId: passagem.contactId, status: 'open' },
        data: { stageId },
    })

    return movidos.count > 0
        ? { ok: true, detalhe: `${movidos.count} negócio(s) movido(s)` }
        : { ok: true, detalhe: 'nenhum negócio aberto; nada a mover' }
}

// ─────────────────────────────── Atribuir ───────────────────────────────

/**
 * Põe um responsável nas conversas abertas do contato.
 *
 * **Não escreve `atendidaPor`.** Atribuir é dar dono; dizer que a equipe assumiu
 * é outra coisa, e quem a diz é a pessoa ao responder. Marcar `atendidaPor` aqui
 * pararia o próprio funil no passo seguinte, pelo freio `humano_assumiu` — o
 * funil se desligaria sozinho, e o motivo na tela diria que alguém atendeu
 * quando ninguém atendeu.
 */
export async function atribuir(passagem: Passagem, config: unknown): Promise<ResultadoDaAcao> {
    const userId = texto(config, 'userId')
    if (!userId) return { ok: false, definitivo: true, motivo: 'passo sem responsável escolhido' }

    /**
     * `isActive` entra na conferência: pessoa desativada não recebe trabalho.
     * Sem isso, um funil escrito meses atrás continuaria atribuindo conversa a
     * quem saiu da clínica, e a conversa ficaria com dono que nunca abre o
     * sistema — pior que ficar sem dono, porque o rodízio não a pega de volta.
     */
    const membro = await prisma.workspaceUser.findFirst({
        where: { workspaceId: passagem.workspaceId, userId, isActive: true },
        select: { id: true },
    })
    if (!membro) {
        return {
            ok: false,
            definitivo: true,
            motivo: 'a pessoa não está ativa na equipe desta unidade',
        }
    }

    const tocadas = await prisma.conversation.updateMany({
        where: {
            workspaceId: passagem.workspaceId,
            contactId: passagem.contactId,
            status: { not: 'closed' },
        },
        data: { assignedTo: userId, ownerAssignedAt: new Date(), ownerSource: 'funil' },
    })

    return tocadas.count > 0
        ? { ok: true, detalhe: `${tocadas.count} conversa(s) atribuída(s)` }
        : { ok: true, detalhe: 'nenhuma conversa aberta; nada a atribuir' }
}

// ──────────────────────────── Mensagem: e-mail ────────────────────────────

/**
 * Manda o e-mail de um passo.
 *
 * Mesmo caminho da campanha — `renderCampanha` e `enviarPorSes` —, de propósito:
 * dois renderizadores divergiriam, e o que divergiria primeiro é o rodapé de
 * descadastro, que é obrigatório por lei e por reputação.
 */
export async function enviarEmailDoPasso(
    passagem: Passagem,
    config: unknown
): Promise<ResultadoDaAcao> {
    if (!passagem.contato?.email) {
        return { ok: false, definitivo: true, motivo: 'o contato não tem e-mail' }
    }

    const remetente = await remetenteDoFunil(passagem.workspaceId)
    if (!remetente) {
        return {
            ok: false,
            definitivo: true,
            motivo: 'nenhum remetente verificado nesta unidade',
        }
    }

    const conteudo = await conteudoDoPasso(passagem.workspaceId, config)
    if (!conteudo) {
        return { ok: false, definitivo: true, motivo: 'passo sem assunto ou sem conteúdo' }
    }

    const campos: CamposDaMesclagem = {
        nome: primeiroNome(passagem.contato.name),
        nomeCompleto: passagem.contato.name,
        unidade: remetente.nomeDoRemetente,
    }

    /**
     * O descadastro aponta para o **nosso** host, não para o domínio do cliente:
     * somos nós que servimos a rota e gravamos o opt-out. O domínio dele aparece
     * no remetente, que é o que quem lê enxerga.
     */
    const descadastroUrl = await urlDeDescadastro(
        appUrl(),
        passagem.workspaceId,
        passagem.contactId
    )

    const casca = {
        blocos: conteudo.blocos,
        campos,
        assinatura: remetente.nomeDoRemetente,
        descadastroUrl,
        preheader: conteudo.preheader ?? undefined,
    }

    const r = await enviarPorSes({
        de: remetente.de,
        nomeDoRemetente: remetente.nomeDoRemetente,
        responderPara: remetente.replyTo,
        para: passagem.contato.email,
        assunto: conteudo.assunto,
        html: renderCampanha(casca),
        texto: campanhaEmTexto(casca),
        configurationSet: remetente.configurationSet ?? undefined,
        descadastroUrl,
        // Só ids: o SES aceita `[A-Za-z0-9_-]` em tag, e nome de funil tem
        // espaço e acento. É por `funnelRun` que o recibo acha a passagem.
        tags: { funnelRun: passagem.runId, funnel: passagem.funnelId },
    })

    if (r.ok) return { ok: true, detalhe: r.messageId }
    return { ok: false, definitivo: Boolean(r.definitivo), motivo: r.error ?? 'falha no SES' }
}

// ────────────────────────── Mensagem: WhatsApp ──────────────────────────

/**
 * O passo de WhatsApp — **desenhado e bloqueado**, como o Broadcast.
 *
 * Fora da janela de 24 horas, mandar WhatsApp exige template HSM aprovado, e o
 * app oficial da Meta está em revisão. O caminho por QR fica fora por
 * construção: disparo em massa por linha pareada dá ban do número **do
 * cliente**, e `src/lib/marketing/lines.ts` já recusa.
 *
 * Devolve motivo definitivo em vez de passar batido. Passar batido seria o pior
 * desfecho: o funil continuaria andando, a pessoa nunca receberia aquele passo,
 * e a tela mostraria a passagem como concluída com sucesso.
 */
export async function enviarWhatsAppDoPasso(): Promise<ResultadoDaAcao> {
    return {
        ok: false,
        definitivo: true,
        motivo: 'o canal oficial de WhatsApp está em revisão na Meta; o passo não pode sair ainda',
    }
}

// ───────────────────────────── Auxiliares ─────────────────────────────

function texto(config: unknown, chave: string): string | undefined {
    const c = typeof config === 'object' && config !== null ? (config as Record<string, unknown>) : {}
    const v = c[chave]
    return typeof v === 'string' && v.length > 0 ? v : undefined
}
