import prisma from '@/lib/prisma'
import { createLogger } from '@/trabalhos/registro'
import { credenciaisDoSes, lerIdentidade } from '@/lib/email/ses'

const log = createLogger('CRON:SES-REMETENTE')

/**
 * Pergunta ao SES se o DKIM dos remetentes pendentes já foi encontrado.
 *
 * ## Por que um cron e não um webhook
 *
 * O SES não avisa quando uma identidade verifica — ele verifica sozinho,
 * consultando o DNS do cliente de tempos em tempos, e o estado só aparece se
 * alguém perguntar. Sem esta rotina, o remetente ficaria `pending` para sempre
 * e a clínica que publicou os CNAME corretamente nunca conseguiria disparar.
 *
 * ## Por que desiste depois de uma semana
 *
 * Quem publicou os registros verifica em horas. Passada uma semana, o que há é
 * um domínio que ninguém vai configurar — e continuar perguntando por ele
 * custa uma chamada por remetente abandonado, para sempre, em três apps.
 *
 * `failed` **não apaga nada**: os tokens ficam, a tela segue mostrando os CNAME,
 * e recadastrar o domínio volta a tentar. É desistir de perguntar, não de
 * atender.
 */
const DIAS_ATE_DESISTIR = 7

export async function runSesVerificarRemetente(): Promise<void> {
    // Nos apps onde a campanha de e-mail ainda não foi ligada não há o que
    // perguntar, e a rotina sai calada — não é defeito, é feature desligada.
    if (!credenciaisDoSes()) return

    const limite = new Date(Date.now() - DIAS_ATE_DESISTIR * 24 * 60 * 60 * 1000)

    const pendentes = await prisma.emailSender.findMany({
        where: { status: 'pending' },
        select: { id: true, domain: true, createdAt: true, workspaceId: true },
        // Teto para um app com muitos remetentes travados não estourar o tempo
        // do cron. Os que sobrarem entram na próxima volta — a rotina roda de
        // dez em dez minutos, e verificar não tem pressa.
        take: 50,
        orderBy: { lastCheckedAt: 'asc' },
    })

    if (pendentes.length === 0) return

    let verificados = 0
    let desistidos = 0

    for (const remetente of pendentes) {
        const resultado = await lerIdentidade(remetente.domain)

        if (!resultado.ok) {
            /**
             * Falha de consulta **não** mexe no estado do remetente.
             *
             * Rede fora ou SES indisponível não diz nada sobre o DNS do
             * cliente, e marcar `failed` aqui mandaria a tela pedir que ele
             * conferisse registros que estão certos. Só carimba a data da
             * tentativa, para a ordenação não travar neste.
             */
            await prisma.emailSender.update({
                where: { id: remetente.id },
                data: { lastCheckedAt: new Date() },
            })
            log.warn(`${remetente.domain}: ${resultado.error}`)
            continue
        }

        const { identidade } = resultado
        const venceu = remetente.createdAt < limite

        const novoStatus = identidade.prontaParaEnvio
            ? 'verified'
            : identidade.dkimStatus === 'FAILED' || venceu
              ? 'failed'
              : 'pending'

        await prisma.emailSender.update({
            where: { id: remetente.id },
            data: {
                status: novoStatus,
                dkimStatus: identidade.dkimStatus,
                // Os tokens podem mudar se a identidade foi recriada do outro
                // lado; a tela mostra o que o SES espera agora, não o que ela
                // mostrava antes.
                ...(identidade.tokens.length > 0 ? { dkimTokens: identidade.tokens } : {}),
                lastCheckedAt: new Date(),
                ...(identidade.prontaParaEnvio ? { verifiedAt: new Date() } : {}),
            },
        })

        if (novoStatus === 'verified') verificados++
        if (novoStatus === 'failed') desistidos++
    }

    log.info(
        `${pendentes.length} remetente(s) consultado(s): ${verificados} verificado(s), ${desistidos} desistido(s)`
    )
}
