import { importJWK, SignJWT, type JWK } from 'jose'

/**
 * O lado do app: a rota que assina o token (ADR 0003).
 *
 * Mora no pacote do widget para instalar virar três passos — dependência, rota,
 * provider — em vez de cada app reimplementar a assinatura e errar o `aud`, a
 * validade ou uma claim.
 *
 * **A chave privada nunca sai do app.** Esta função recebe uma maneira de
 * obtê-la (do segredo do Worker daquele app) e nunca a guarda. O Venn Desk só
 * conhece a metade pública.
 *
 * **A validade é curta e o teto é do Desk.** 10 minutos: o Desk recusa token
 * com vida maior (`VALIDADE_MAXIMA_S` em `src/auth/token-app.ts`), porque
 * vazamento de token com validade longa vira acesso permanente a algo que ele
 * não tem como revogar.
 */

export interface IdentidadeDoApp {
    /** Id do usuário NO APP. Vira `requesters.external_id`. */
    usuarioId: string
    /** Id da unidade NO APP — o `Workspace`. Vira `tenants.external_id`. */
    tenantId: string
    /**
     * O NOME da unidade.
     *
     * Opcional, e por isso existe: sem ele o Venn Desk cai no id, e a fila do
     * atendente mostra `cmwk0b3g…` na coluna da empresa em vez de "Clínica
     * Sorriso Centro". Era assim até 18/11/2026.
     */
    tenantNome?: string
    /**
     * A CONTA acima da unidade (`Account → Workspace[]` nos apps).
     *
     * Também opcional, e também muda o atendimento: três chamados de três
     * unidades da mesma rede, sem conta, parecem três clientes com azar; com
     * conta, são uma rede com uma semana ruim. E metade dos escalonamentos
     * obrigatórios — cobrança, cancelamento — é assunto de conta.
     */
    contaId?: string
    contaNome?: string
    nome: string
    email: string
    /** `admin` ou `owner` fazem o usuário ver os chamados da empresa. */
    papel?: string
    plano?: string
}

export const VALIDADE_S = 600
const PUBLICO = 'venn-desk'

export function criarRotaDeToken(opcoes: {
    /** Slug do app no Venn Desk. */
    app: string
    /** A chave privada, em JWK. Leia do segredo do Worker, nunca do código. */
    chavePrivada: () => JWK | Promise<JWK>
    /**
     * Quem está logado, a partir da requisição. É aqui que entra o Better Auth
     * do app. Devolva `null` quando não houver sessão: a resposta será 401, e o
     * widget simplesmente não renderiza.
     */
    identidade: (requisicao: Request) => Promise<IdentidadeDoApp | null>
}): (requisicao: Request) => Promise<Response> {
    return async function rota(requisicao: Request): Promise<Response> {
        /// Só POST: um GET seria cacheável por intermediário, e token em cache
        /// compartilhado é token de outra pessoa.
        if (requisicao.method !== 'POST') {
            return Response.json({ erro: 'Use POST.' }, { status: 405 })
        }

        const quem = await opcoes.identidade(requisicao)
        if (quem === null) {
            return Response.json({ erro: 'Sem sessão.' }, { status: 401 })
        }

        const jwk = await opcoes.chavePrivada()
        const chave = await importJWK(jwk, 'Ed25519')
        const agora = Math.floor(Date.now() / 1000)

        const token = await new SignJWT({
            app: opcoes.app,
            tenant_id: quem.tenantId,
            user_id: quem.usuarioId,
            nome: quem.nome,
            email: quem.email,
            papel: quem.papel ?? 'member',
            ...(quem.plano === undefined ? {} : { plano: quem.plano }),
            /**
             * As claims opcionais só entram quando existem.
             *
             * Mandar `tenant_nome: undefined` viraria `null` no JSON e o
             * esquema do Desk recusaria o token inteiro — por um campo que é
             * opcional de propósito.
             */
            ...(quem.tenantNome === undefined ? {} : { tenant_nome: quem.tenantNome }),
            ...(quem.contaId === undefined ? {} : { account_id: quem.contaId }),
            ...(quem.contaNome === undefined ? {} : { account_nome: quem.contaNome }),
        })
            .setProtectedHeader({ alg: 'Ed25519' })
            .setAudience(PUBLICO)
            .setIssuedAt(agora)
            .setExpirationTime(agora + VALIDADE_S)
            .sign(chave)

        return Response.json(
            { token, expiraEm: (agora + VALIDADE_S) * 1000 },
            {
                /// Nunca cacheado, em lugar nenhum do caminho.
                headers: { 'Cache-Control': 'no-store, private' },
            }
        )
    }
}
