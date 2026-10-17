import 'server-only'

/**
 * O endereço de volta do OAuth do Instagram, e o recado que viaja com ele.
 *
 * **Por que um redirecionamento e não o SDK do Facebook.** A primeira versão
 * abria `FB.login` e mandava o código ao servidor. A Meta recusou a troca:
 *
 * > Error validating verification code. Please make sure your redirect_uri is
 * > identical to the one you used in the OAuth dialog request
 *
 * E está certa — a documentação dela diz que `redirect_uri` *"is required and
 * must be the same as the original request_uri"*. Pelo SDK esse valor é
 * escolhido pelo próprio SDK, não por nós, então não há o que repetir na troca.
 * O Embedded Signup do WhatsApp é a exceção documentada que dispensa o
 * parâmetro; o login comum, não.
 *
 * Com o redirecionamento o endereço é **nosso**, idêntico por construção nas
 * duas pontas, e registrado uma vez em *URIs de redirecionamento válidos* no
 * painel da Meta. É também o mesmo desenho que o Google Calendar já usa aqui —
 * ver `lib/google-oauth-client.ts`.
 */

/** O caminho de volta. Tem de bater, caractere a caractere, nas duas pontas. */
export function redirectUriFor(origin: string): string {
    return `${origin}/api/integrations/instagram/callback`
}

export interface EstadoDoFluxo {
    agentId: string
    workspaceId: string
    userId: string
    /** Para onde devolver a pessoa no fim, com o resultado. */
    voltarPara: string
}

/**
 * O `state`, que leva o contexto e serve de prova de origem.
 *
 * Não é cofre: vai e volta pelo navegador, em base64url, e qualquer um lê. Por
 * isso **nada aqui é tratado como autorização** — o callback confere a sessão e
 * o acesso ao agente de novo, do zero. O que ele evita é a volta de um fluxo
 * que ninguém começou.
 */
export function codificarEstado(estado: EstadoDoFluxo): string {
    return Buffer.from(JSON.stringify(estado)).toString('base64url')
}

export function lerEstado(bruto: string | null): EstadoDoFluxo | null {
    if (!bruto) return null
    try {
        const lido = JSON.parse(Buffer.from(bruto, 'base64url').toString()) as Partial<EstadoDoFluxo>
        if (!lido.agentId || !lido.workspaceId || !lido.userId) return null
        return {
            agentId: lido.agentId,
            workspaceId: lido.workspaceId,
            userId: lido.userId,
            voltarPara: lido.voltarPara ?? '/atendimento/agentes/integracoes',
        }
    } catch {
        return null
    }
}

/** A página de onde a pessoa saiu, com o resultado grudado. */
export function voltaCom(
    estado: EstadoDoFluxo | null,
    chave: 'instagram_ok' | 'instagram_erro',
    valor: string
): string {
    const base = estado?.voltarPara ?? '/atendimento/agentes/integracoes'
    const separador = base.includes('?') ? '&' : '?'
    return `${base}${separador}${chave}=${encodeURIComponent(valor)}`
}
