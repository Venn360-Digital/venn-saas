import 'server-only'

import prisma from '@venn/db/cliente'

import { BRAND } from '../../marca'
import { sortearToken } from '../convite/token'
/**
 * Os prazos vêm de um módulo NEUTRO, e são reexportados daqui por conveniência.
 *
 * A tela de envio precisa do teto e **não pode importar este arquivo**: ele lê
 * a marca em `urlDaProposta`, e `lint-workspace.mjs` reprova o build quando um
 * módulo de cliente alcança o registro da marca. Ver `./validade.ts`.
 */
import { origemDoApp } from '../base-publica'
import { validadeEmDias, VALIDADE_MAXIMA_EM_DIAS, VALIDADE_PADRAO_EM_DIAS } from './validade'

export { validadeEmDias, VALIDADE_MAXIMA_EM_DIAS, VALIDADE_PADRAO_EM_DIAS }

/**
 * O link público do documento — a única porta sem autenticação do produto.
 *
 * ## Os sete requisitos, e por que nenhum é opcional
 *
 * | | |
 * |---|---|
 * | Token de 32 bytes de CSPRNG | adivinhável = proposta de outro cliente exposta |
 * | `expiresAt` obrigatório | link que vive para sempre é vazamento com data marcada |
 * | Revogável | o vendedor erra o destinatário, e vai errar |
 * | **A mesma 404** para inexistente, expirado e revogado | respostas diferentes permitem enumerar tokens |
 * | Rate limit por IP e por token | `lib/limite.ts`, na rota |
 * | Projeção mínima | sem id interno, sem custo, sem observação interna, sem nenhuma outra proposta da unidade |
 * | Trilha no aceite | nome, IP, user-agent, carimbo, hash do conteúdo |
 *
 * ## Por que o token fica em claro no banco, diferente do convite
 *
 * `lib/convite/token.ts` guarda só o SHA-256, e a razão é que lá o token **é**
 * credencial: quem o tem define a senha de um usuário. Aqui ele abre um
 * documento de leitura, e a tela precisa poder reexibir o link que acabou de
 * gerar — "copiar o link" é a ação principal da tela de envio. Guardar só o
 * resumo obrigaria a mostrar o link uma vez e nunca mais, que é certo para
 * convite e errado para isto.
 *
 * O que compensa a diferença é o resto: validade obrigatória, revogação, e a
 * projeção mínima na página.
 */

export interface LinkCriado {
    shareId: string
    token: string
    url: string
    expiresAt: Date
}

/** O endereço público de um token. Curto porque vai no WhatsApp. */
export function urlDaProposta(token: string): string {
    /**
     * `origemDoApp()`, e **não** `NEXT_PUBLIC_APP_URL`.
     *
     * A primeira versão desta linha lia a variável com
     * `https://${BRAND().appHost}` de reserva, e a homologação de 21/11/2026
     * mostrou o que isso vale: a variável não está gravada nos Workers de
     * homologação, então o link do e-mail apontava para **produção** — que
     * responde `307` para `/login`, porque lá a rota pública não existe. A razão
     * de fundo está em `lib/base-publica.ts`.
     */
    return `${origemDoApp()}/p/${token}`
}

/**
 * Cria o link de uma revisão.
 *
 * Não valida estado nem permissão: quem chama já o fez. Aqui é só o sorteio e a
 * gravação.
 */
export async function criarLink(
    revisionId: string,
    userId: string,
    dias?: number
): Promise<LinkCriado> {
    // `sortearToken` devolve o par (claro, resumo). Aqui só o claro interessa —
    // ver a nota do cabeçalho sobre por que não guardamos o resumo.
    const { token } = await sortearToken()
    const expiresAt = validadeEmDias(dias)

    const share = await prisma.proposalShare.create({
        data: { revisionId, token, userId, expiresAt },
        select: { id: true },
    })

    return { shareId: share.id, token, url: urlDaProposta(token), expiresAt }
}

/**
 * O documento como o cliente o vê — a projeção mínima.
 *
 * O que NÃO sai daqui, e cada omissão é deliberada: id interno de nada
 * (enumerar), `notes` da revisão (é observação interna do vendedor — o que o
 * cliente lê vem do template), o responsável com e-mail, o custo, a margem, o
 * negócio, o funil, e qualquer outra proposta da unidade.
 *
 * Devolve `null` para inexistente, expirado **e** revogado. Os três
 * indistinguíveis: a rota responde a mesma 404, porque respostas diferentes
 * permitiriam a quem adivinha tokens descobrir quais existem.
 */
export async function documentoPublico(token: string) {
    const agora = new Date()

    const share = await prisma.proposalShare.findFirst({
        where: {
            token,
            revokedAt: null,
            expiresAt: { gt: agora },
            // Proposta apagada não abre, mesmo com o link na mão. O `DELETE`
            // revoga os links, mas isto é a segunda linha — e cobre a linha
            // antiga de antes de aquela revogação existir.
            revision: { proposal: { deletedAt: null } },
        },
        select: {
            id: true,
            expiresAt: true,
            acceptedAt: true,
            acceptedByName: true,
            revision: {
                select: {
                    id: true,
                    subtotal: true,
                    discount: true,
                    total: true,
                    validUntil: true,
                    status: true,
                    createdAt: true,
                    // O congelado no envio — é o que a página pública mostra
                    // quando existe. Ver `lib/propostas/contexto.ts`.
                    sections: true,
                    variableValues: true,
                    items: {
                        orderBy: { order: 'asc' },
                        select: {
                            description: true,
                            quantity: true,
                            unitPrice: true,
                            discountPct: true,
                            total: true,
                            productService: { select: { unit: true } },
                        },
                    },
                    proposal: {
                        select: {
                            kind: true,
                            title: true,
                            number: true,
                            currency: true,
                            createdAt: true,
                            // `theme` é a identidade do modelo (cor), não dado do cliente.
                            template: { select: { body: true, sections: true, theme: true } },
                            /**
                             * Só o NOME do responsável e o do contato. Sem
                             * e-mail, sem telefone, sem id, sem valor do negócio.
                             *
                             * A v2 NÃO alargou isto, de propósito: telefone,
                             * e-mail, CNPJ e o resto chegam à página pública
                             * **congelados** em `variableValues`, gravados no
                             * envio por uma rota autenticada. A projeção viva
                             * continua mínima — e `check:proposta-publica`
                             * varre este `select` para que continue.
                             */
                            createdBy: { select: { name: true } },
                            deal: { select: { contact: { select: { name: true } } } },
                            workspace: { select: { name: true, logo: true } },
                        },
                    },
                },
            },
        },
    })

    return share
}

export type DocumentoPublico = NonNullable<Awaited<ReturnType<typeof documentoPublico>>>

/**
 * Registra uma abertura.
 *
 * Nunca lança, e é decisão: a página do cliente não pode deixar de abrir porque
 * a contagem falhou. Perder um registro de visualização é perder uma métrica;
 * não abrir é perder a venda.
 */
export async function registrarAbertura(
    shareId: string,
    ip: string | null,
    userAgent: string | null
): Promise<void> {
    try {
        await prisma.proposalShareView.create({ data: { shareId, ip, userAgent } })
    } catch (error) {
        console.error('[PROPOSTA_ABERTURA]', error)
    }
}

/**
 * O hash do conteúdo aceito.
 *
 * É o que transforma "ele clicou em aceitar" em "ele aceitou **este** texto":
 * meses depois, com o template já alterado, o hash prova qual conteúdo estava
 * na tela. `crypto.subtle` e não `node:crypto`, porque é o que existe no Worker
 * — a mesma razão registrada em `lib/convite/token.ts`.
 */
export async function hashDoConteudo(html: string): Promise<string> {
    const dados = new TextEncoder().encode(html)
    const digest = await crypto.subtle.digest('SHA-256', dados)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
