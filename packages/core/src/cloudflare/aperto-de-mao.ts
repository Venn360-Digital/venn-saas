/// <reference types="@cloudflare/workers-types" />

import { BilheteInvalidoError, segredoDoBilhete, verificar } from '../lib/realtime/bilhete'

/**
 * O aperto de mão do WebSocket do tempo real.
 *
 * **Atendido no `fetch` do Worker, antes do vinext.** Não é preferência de
 * organização: a resposta de um upgrade é um `101` com a propriedade
 * `webSocket`, que é extensão do runtime da Cloudflare — passá-la pelo
 * roteamento do Next, que embrulha `Request` e `Response`, é apostar que o
 * embrulho preserva uma propriedade não-padrão. Aqui não há aposta.
 *
 * A autorização **já aconteceu**, em `/api/tempo-real/bilhete`, que é rota do
 * Next e por isso alcança a sessão e a participação em workspace. Aqui só se
 * confere a assinatura — sem banco, porque é um socket por aba e rede de
 * clínica reconecta.
 */
interface EnvDoAperto {
    SALA_DO_WORKSPACE: DurableObjectNamespace
}

/** O caminho que o navegador abre. */
export const CAMINHO = '/tempo-real'

export function ehAperto(url: URL): boolean {
    return url.pathname === CAMINHO
}

export async function aperto(request: Request, env: EnvDoAperto): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('esperado upgrade para websocket', { status: 426 })
    }

    const url = new URL(request.url)
    const bilhete = url.searchParams.get('b')

    if (!bilhete) {
        // 401 e não 400: o que falta é credencial, e o cliente sabe pedir outra.
        return new Response('sem bilhete', { status: 401 })
    }

    let dados
    try {
        dados = await verificar(bilhete, segredoDoBilhete())
    } catch (erro) {
        if (erro instanceof BilheteInvalidoError) {
            /**
             * O motivo vai para o log, **nunca** para a resposta.
             *
             * Dizer ao cliente "assinatura" em vez de "vencido" diferencia
             * bilhete forjado de bilhete velho, e isso é o que um atacante usa
             * para saber se está no caminho certo. O cliente só precisa saber
             * que tem de pedir outro.
             */
            console.warn(`[TEMPO-REAL] bilhete recusado: ${erro.motivo}`)
            return new Response('bilhete inválido', { status: 401 })
        }
        console.error('[TEMPO-REAL] falha ao verificar bilhete:', erro)
        return new Response('erro ao autorizar', { status: 500 })
    }

    /**
     * `idFromName(workspaceId)`: a sala é a do workspace do bilhete, e de mais
     * nenhum.
     *
     * Isto conserta, de graça, um defeito que o tempo real anterior tinha e está
     * descrito na tela de conversas: a assinatura de `postgres_changes` não
     * filtrava por workspace, e a RLS liberava as linhas de **toda** unidade de
     * que a pessoa participa. Quem atende em duas clínicas ouvia o aviso sonoro
     * da outra. Aqui o workspace não é filtro aplicado depois — é o endereço do
     * objeto.
     */
    const sala = env.SALA_DO_WORKSPACE.get(env.SALA_DO_WORKSPACE.idFromName(dados.workspaceId))

    // O usuário vai na query para a sala etiquetar a conexão: é o que permite
    // endereçar evento a uma pessoa só (`paraUsuario`), como o lembrete de
    // atividade.
    const interna = new URL('http://sala/conectar')
    interna.searchParams.set('usuario', dados.usuarioId)

    return sala.fetch(new Request(interna.toString(), request))
}
