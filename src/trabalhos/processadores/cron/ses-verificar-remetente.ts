import prisma from '@/lib/prisma'
import { createLogger } from '@/trabalhos/registro'
import { credenciaisDoSes } from '@/lib/email/ses'
import { conferirRemetente } from '@/lib/marketing/conferir-remetente'

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
        /**
         * A consulta e a gravação moram em `conferirRemetente`, porque o botão
         * "Verificar agora" da ficha faz exatamente a mesma coisa. Aqui sobra o
         * que é só da rotina: o lote, o teto, e a decisão de desistir.
         */
        const desfecho = await conferirRemetente(remetente, remetente.createdAt < limite)

        if (!desfecho.ok) {
            log.warn(`${remetente.domain}: ${desfecho.error}`)
            continue
        }

        if (desfecho.status === 'verified') verificados++
        if (desfecho.status === 'failed') desistidos++
    }

    log.info(
        `${pendentes.length} remetente(s) consultado(s): ${verificados} verificado(s), ${desistidos} desistido(s)`
    )
}
