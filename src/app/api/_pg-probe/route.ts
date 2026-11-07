import { NextResponse } from 'next/server'

/**
 * Sonda de experimento: o `pg` carrega e conecta dentro do Worker?
 *
 * **Isto não vai para produção.** Existe para responder a uma pergunta que esta
 * máquina não consegue responder (o `workerd` não roda em macOS 12), e que
 * decide se o Hyperdrive é um caminho possível: o Hyperdrive fala Postgres por
 * TCP e exige `@prisma/adapter-pg`, que hoje está FORA do bundle de propósito —
 * `src/lib/shims/adapter-pg-vazio.ts` o substitui, porque em 2026-10-21 a `pg`
 * executava código de Node na carga do módulo e o deploy morria com
 * `[code: 10021] validation error`.
 *
 * A pergunta tem duas metades e a rota separa as duas:
 *
 * 1. **A `pg` carrega?** Se não carregar, o Worker nem sobe — e aí nem esta
 *    rota nem nenhuma outra responde. O `/login` respondendo já é meia resposta.
 * 2. **A `pg` conecta?** É o que o `SELECT 1` abaixo mede.
 *
 * Não devolve dado nenhum do banco: só se deu certo, quanto demorou, e a
 * mensagem de erro quando falha.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
    const t0 = Date.now()
    let carregou = false

    try {
        const { PrismaPg } = await import('@prisma/adapter-pg')
        carregou = true
        const tCarga = Date.now() - t0

        const url = process.env.HYPERDRIVE_URL || process.env.DATABASE_URL
        if (!url) {
            return NextResponse.json({ carregou, conectou: false, erro: 'sem URL' })
        }

        const t1 = Date.now()
        const adapter = new PrismaPg({ connectionString: url })
        const conn = await adapter.connect()
        await conn.queryRaw({ sql: 'SELECT 1', args: [], argTypes: [] })
        const tConexao = Date.now() - t1

        return NextResponse.json({
            carregou,
            conectou: true,
            via: process.env.HYPERDRIVE_URL ? 'hyperdrive' : 'direto',
            ms_carga: tCarga,
            ms_conexao_e_consulta: tConexao,
        })
    } catch (erro) {
        return NextResponse.json({
            carregou,
            conectou: false,
            erro: erro instanceof Error ? erro.message.slice(0, 300) : String(erro).slice(0, 300),
        })
    }
}
