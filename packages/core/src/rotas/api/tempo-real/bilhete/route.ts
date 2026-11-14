import { NextResponse } from 'next/server'
import { getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { assinar, segredoDoBilhete, VALIDADE_SEGUNDOS } from '@venn/core/lib/realtime/bilhete'

/**
 * Emite o bilhete que abre o socket do tempo real.
 *
 * **Esta rota é a autorização.** O `fetch` do Worker, que encaminha para a sala,
 * só confere a assinatura — não consulta banco. Por dois motivos:
 *
 * 1. resolver participação em workspace é obrigação de `lib/auth/workspace.ts`,
 *    e `scripts/lint-workspace.mjs` reprova o build se aparecer outro lugar;
 * 2. `usuarioDaSessao()` depende de `next/headers`, que não existe fora do
 *    contexto de requisição do Next.
 *
 * E há uma razão de custo: é um socket por aba aberta. Consultar participação a
 * cada conexão pagaria uma conexão de Postgres por reconexão de rede de cada
 * atendente, e rede de clínica oscila.
 */
export async function POST() {
    try {
        const auth = await getWorkspaceMember()
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status })
        }

        const bilhete = await assinar(
            { workspaceId: auth.member.workspaceId, usuarioId: auth.member.userId },
            segredoDoBilhete()
        )

        return NextResponse.json(
            { bilhete, validadeSegundos: VALIDADE_SEGUNDOS },
            // Nunca cacheado: é credencial de uso único e vida curta, e uma
            // borda que o guardasse o entregaria à aba seguinte — de outra
            // pessoa, no mesmo navegador compartilhado da recepção.
            { headers: { 'cache-control': 'no-store' } }
        )
    } catch (error) {
        console.error('[TEMPO_REAL] falha ao emitir bilhete:', error)
        return NextResponse.json({ error: 'Erro ao autorizar o tempo real' }, { status: 500 })
    }
}
