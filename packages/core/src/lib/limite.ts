import prisma from '@venn/db/cliente'

/**
 * Contador de taxa em banco, para o que não passa pelo Better Auth.
 *
 * ## Por que em banco, e não em memória
 *
 * Pelo mesmo motivo que `lib/auth/better-auth.ts` já documenta para o limite de
 * autenticação: no Worker da Cloudflare um `Map` vive **por isolate**, e há
 * muitos. Um contador em memória conta quase nada e dá a impressão de limitar.
 *
 * ## Por que reusa `auth_rate_limits`
 *
 * Porque criar tabela exige migração, e a migração está — de propósito —
 * travada até o Environment do GitHub declarar `DB_HOST_ESPERADO` (ver
 * `.github/workflows/migrate.yml`). A tabela é um contador genérico: `key`
 * único, `count`, `lastRequest`. As chaves daqui levam prefixo próprio e não
 * colidem com as do Better Auth.
 *
 * Quando houver migração livre, uma tabela própria é mais limpa — mas não vale
 * segurar um controle de abuso esperando por isso.
 *
 * ## A janela é deslizante por reinício, não por rolagem
 *
 * Passada a janela desde a **última** requisição contada, o contador zera.
 * É a mesma aproximação que o Better Auth usa, e é suficiente para o que isto
 * protege: enxurrada, não uso irregular.
 */
export async function dentroDoLimite(
    chave: string,
    teto: number,
    janelaSegundos: number
): Promise<boolean> {
    const agora = BigInt(Date.now())
    const janela = BigInt(janelaSegundos * 1000)

    const atual = await prisma.authRateLimit.findUnique({
        where: { key: chave },
        select: { count: true, lastRequest: true },
    })

    if (!atual || agora - atual.lastRequest > janela) {
        await prisma.authRateLimit.upsert({
            where: { key: chave },
            create: { key: chave, count: 1, lastRequest: agora },
            update: { count: 1, lastRequest: agora },
        })
        return true
    }

    if (atual.count >= teto) {
        /**
         * **Não** carimba `lastRequest` ao recusar.
         *
         * Carimbar faria quem insiste empurrar a janela para sempre e nunca
         * sair do bloqueio — um limitador que pune a persistência em vez de
         * limitar a taxa. Quem parou de bater volta a passar quando a janela
         * vence, contada da última requisição **aceita**.
         */
        return false
    }

    await prisma.authRateLimit.update({
        where: { key: chave },
        data: { count: { increment: 1 }, lastRequest: agora },
    })
    return true
}

/** O IP de quem chamou, como a Cloudflare o entrega. */
export function ipDaRequisicao(request: Request): string {
    return (
        request.headers.get('cf-connecting-ip') ??
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        'desconhecido'
    )
}
