import 'server-only'
import prisma from '@venn/db/cliente'
import { credenciaisDoSes, lerIdentidade } from '@/lib/email/ses'
import { situacaoDoRemetente } from './situacao-do-remetente'

/**
 * Pergunta ao SES o estado de **um** domínio e grava o resultado.
 *
 * Existe porque dois caminhos fazem exatamente isto: a rotina
 * `ses-verificar-remetente`, de hora em hora, e o botão "Verificar agora" da
 * ficha do domínio. A gravação escrita nos dois lugares divergiria no primeiro
 * campo novo — e a divergência apareceria como "o botão diz uma coisa e a tela
 * mostra outra".
 *
 * A decisão de **qual** situação gravar é pura e mora em `situacaoDoRemetente`.
 * Aqui fica só a consulta e a escrita.
 */

export type DesfechoDaConferencia =
    | { ok: true; status: 'pending' | 'verified' | 'failed'; dkimStatus: string | null }
    /** Não deu para perguntar. O estado do remetente **não** muda. */
    | { ok: false; error: string }

export async function conferirRemetente(
    remetente: { id: string; domain: string },
    /**
     * Desistir deste domínio se o SES ainda não o encontrou.
     *
     * `true` só na rotina, e só para domínio abandonado há uma semana — é
     * decisão sobre parar de perguntar, não sobre o DNS do cliente. No botão é
     * sempre `false`: quem clica está mexendo no DNS naquele instante.
     */
    venceu = false
): Promise<DesfechoDaConferencia> {
    if (!credenciaisDoSes()) return { ok: false, error: 'SES não configurado' }

    const resultado = await lerIdentidade(remetente.domain)

    if (!resultado.ok) {
        /**
         * Falha de consulta **não** mexe no estado.
         *
         * Rede fora ou SES indisponível não diz nada sobre o DNS do cliente, e
         * marcar `failed` aqui mandaria a tela pedir que ele conferisse
         * registros que estão certos. Só carimba a data da tentativa, para a
         * ordenação da rotina não travar neste.
         */
        await prisma.emailSender.update({
            where: { id: remetente.id },
            data: { lastCheckedAt: new Date() },
        })
        return { ok: false, error: resultado.error ?? 'não foi possível consultar o SES' }
    }

    const { identidade } = resultado
    const status = situacaoDoRemetente(identidade, venceu)

    await prisma.emailSender.update({
        where: { id: remetente.id },
        data: {
            status,
            dkimStatus: identidade.dkimStatus,
            // Os tokens podem mudar se a identidade foi recriada do outro lado;
            // a tela mostra o que o SES espera **agora**, não o que ela mostrava
            // antes.
            ...(identidade.tokens.length > 0 ? { dkimTokens: identidade.tokens } : {}),
            lastCheckedAt: new Date(),
            ...(identidade.prontaParaEnvio ? { verifiedAt: new Date() } : {}),
        },
    })

    return { ok: true, status, dkimStatus: identidade.dkimStatus }
}
