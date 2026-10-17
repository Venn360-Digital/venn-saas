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

/**
 * O caminho de volta. Tem de bater, caractere a caractere, nas duas pontas.
 *
 * **O endereço público manda, e o da requisição é só reserva.** Derivá-lo do
 * `origin` da requisição parecia mais honesto — é o endereço que o navegador
 * de fato visitou —, mas atrás do Traefik isso depende de o Next confiar no
 * cabeçalho de protocolo do proxy. Resolvendo `http://`, a Meta recusa com
 * *"URL bloqueada"*, e a mensagem não diz que o problema é o esquema: manda
 * conferir a lista de URIs, que está certa. Horas perdidas procurando no lugar
 * errado.
 *
 * Com o valor configurado, as duas pontas leem a mesma constante e são
 * idênticas por construção — que é tudo o que a Meta exige.
 */
export function redirectUriFor(origemDaRequisicao: string): string {
    return `${basePublica(origemDaRequisicao)}/api/integrations/instagram/callback`
}

/**
 * O endereço público da aplicação.
 *
 * `request.nextUrl.origin` **não serve** aqui: atrás do Traefik ele resolveu
 * `https://0.0.0.0:3000` — o endereço com que o contêiner escuta —, e a volta
 * do OAuth jogou a clínica numa URL morta. Medido em 2026-10-16, com a conexão
 * já autorizada do lado da Meta: o fluxo tinha dado certo e a pessoa foi parar
 * no nada.
 *
 * Por isso o valor configurado manda, e o da requisição é só reserva para
 * desenvolvimento, onde não há proxy no caminho.
 */
export function basePublica(origemDaRequisicao: string): string {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/$/, '')
    return base || origemDaRequisicao
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
