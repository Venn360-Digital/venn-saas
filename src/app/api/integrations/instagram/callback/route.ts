import { NextRequest, NextResponse } from 'next/server'

import { manageAgent } from '@/lib/auth/agent'
import { conectarInstagram } from '@/lib/instagram/connect'
import { basePublica, lerEstado, redirectUriFor, voltaCom } from '@/lib/instagram/oauth'

export const runtime = 'nodejs'

/**
 * A volta do diálogo da Meta.
 *
 * Não é uma rota de API no sentido comum: é uma página de passagem. A Meta
 * manda o navegador para cá com um `code` e o `state`, a conexão acontece do
 * lado do servidor, e a pessoa é devolvida à tela de onde saiu com o resultado
 * na URL. Nada volta como JSON porque ninguém está lendo JSON aqui — há um
 * navegador no meio do caminho.
 *
 * **O `state` não autoriza nada.** Ele viaja pelo navegador e qualquer um o lê,
 * então o que ele carrega é contexto, não permissão: a sessão e o acesso ao
 * agente são conferidos de novo, do zero, antes de qualquer escrita. Sem isso,
 * um `state` colado à mão conectaria uma conta no agente de outra clínica.
 */
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams
    const estado = lerEstado(params.get('state'))

    /**
     * O endereço de volta vem da configuração, não da requisição.
     *
     * `request.nextUrl.origin` resolveu `https://0.0.0.0:3000` atrás do
     * Traefik, e a clínica — com a conexão já autorizada na Meta — foi parar
     * numa URL morta. O fluxo tinha funcionado; o que falhou foi dizer isso a
     * ela.
     */
    const base = basePublica(request.nextUrl.origin)

    /**
     * Toda saída deixa rastro — inclusive as que não são erro de rede.
     *
     * Sessão expirada, agente que já tem conta, workspace sem plano e desistência
     * na janela saíam daqui **sem uma linha de log**, e do lado de fora todas se
     * parecem: "cliquei e não aconteceu nada". Hoje isso já custou mais de uma
     * rodada de perguntas para descobrir que a tentativa sequer tinha voltado.
     */
    const voltar = (chave: 'instagram_ok' | 'instagram_erro', valor: string) => {
        console.log(`[INSTAGRAM_OAUTH] ${chave === 'instagram_ok' ? 'ok' : 'erro'}: ${valor}`)
        return NextResponse.redirect(new URL(voltaCom(estado, chave, valor), base))
    }

    /**
     * A clínica desistiu na janela da Meta.
     *
     * `error=access_denied` é o caminho normal de quem fechou ou recusou — não
     * é defeito, e dizer "falha ao conectar" para isso assusta quem só mudou de
     * ideia.
     */
    const erroDaMeta = params.get('error')
    if (erroDaMeta) {
        if (erroDaMeta === 'access_denied') {
            return voltar('instagram_erro', 'Conexão cancelada.')
        }
        const descricao = params.get('error_description') ?? erroDaMeta
        return voltar('instagram_erro', `A Meta recusou a autorização: ${descricao}`)
    }

    const code = params.get('code')
    if (!code || !estado) {
        return voltar('instagram_erro', 'A volta da Meta veio incompleta. Tente conectar de novo.')
    }

    // De novo e do zero: quem voltou é mesmo quem pode mexer neste agente?
    const auth = await manageAgent(estado.agentId)
    if (!auth.ok) {
        return voltar('instagram_erro', 'Sua sessão expirou ou você não administra este agente.')
    }

    // E o agente é do workspace de quem está logado — não do que o `state` diz.
    const resultado = await conectarInstagram({
        agentId: estado.agentId,
        workspaceId: auth.member.workspaceId,
        code,
        // O mesmo endereço que abriu o diálogo: as duas pontas leem o valor
        // configurado, então são idênticas por construção.
        redirectUri: redirectUriFor(request.nextUrl.origin),
    })

    if (!resultado.ok) return voltar('instagram_erro', resultado.erro)

    return voltar(
        'instagram_ok',
        resultado.username ? `@${resultado.username}` : 'Instagram conectado.'
    )
}
