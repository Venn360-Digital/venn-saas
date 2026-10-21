/// <reference types="@cloudflare/workers-types" />

/**
 * A trava de um contato, como Durable Object.
 *
 * Substitui o `SET NX PX` no Redis — e a substituição é mais forte que o
 * original, não mais fraca: o Redis precisava de um comando atômico porque
 * atende em paralelo, enquanto um Durable Object **atende uma requisição por
 * vez** por chave. Não há corrida a vencer aqui dentro, então não há script
 * Lua, nem `CAS`, nem Redlock.
 *
 * Um objeto por chave, via `idFromName(chave)`. Objeto sem trava ativa não
 * guarda nada e não custa nada.
 */
interface Dono {
    token: string
    expiraEm: number
}

export class TravaDeContato implements DurableObject {
    constructor(
        private readonly state: DurableObjectState,
        private readonly env: unknown
    ) {
        void this.env
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)

        if (url.pathname === '/adquirir') {
            const { token, ttlMs } = (await request.json()) as { token: string; ttlMs: number }
            const agora = Date.now()
            const dono = await this.state.storage.get<Dono>('dono')

            // Dono vivo: recusa. Dono vencido: a trava é tomada — é o TTL
            // existindo para o caso do isolate que morreu na seção crítica.
            if (dono && dono.expiraEm > agora && dono.token !== token) {
                return Response.json({ ok: false, livreEmMs: dono.expiraEm - agora })
            }

            await this.state.storage.put<Dono>('dono', { token, expiraEm: agora + ttlMs })
            return Response.json({ ok: true })
        }

        if (url.pathname === '/liberar') {
            const { token } = (await request.json()) as { token: string }
            const dono = await this.state.storage.get<Dono>('dono')

            // Só o dono libera. Sem esta conferência, um processo cujo TTL
            // venceu derrubaria a trava de quem a pegou em seguida — e os dois
            // entrariam na seção crítica ao mesmo tempo, que é exatamente o que
            // a trava existe para impedir.
            if (dono && dono.token === token) {
                await this.state.storage.delete('dono')
                return Response.json({ ok: true, liberada: true })
            }

            return Response.json({ ok: true, liberada: false })
        }

        return new Response('não encontrado', { status: 404 })
    }
}
