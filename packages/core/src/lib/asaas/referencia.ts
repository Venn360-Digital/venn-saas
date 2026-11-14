import 'server-only'

import { APP } from '../../config/app'

/**
 * A marca de qual app criou uma coisa no Asaas.
 *
 * ## O problema que ela resolve
 *
 * Uma conta Asaas pode servir mais de um produto — é o caso da Venn360, que usa
 * a mesma conta como ERP financeiro. O webhook do Asaas, porém, é **por conta**:
 * cada URL registrada recebe TODOS os eventos, inclusive os do outro produto.
 *
 * Dois caminhos deste código resolvem o dono de um evento pelo **documento**, e
 * documento é a mesma coisa nos dois bancos:
 *
 *   - `vincularContaAoAsaas` procura o cliente por `cpfCnpj` na conta inteira e
 *     adota as assinaturas dele — incluindo `DELETE` na anterior;
 *   - `ligarPeloDocumento` varre as contas locais pelo mesmo CPF/CNPJ.
 *
 * Com CNPJ repetido entre produtos, isso cancela assinatura paga do outro. Na
 * prática o Andre garante que nenhum cliente existe em dois produtos — mas a
 * **conta de teste da própria Venn360** existe em todos, com o mesmo CNPJ, e é
 * justamente ela que vai exercitar a cobrança primeiro.
 *
 * ## Como funciona
 *
 * O que criamos no Asaas leva `externalReference` prefixado com o `APP_SLUG`
 * (por exemplo `<slug>:cus_123`). Quem lê sabe distinguir três casos, e só
 * o primeiro autoriza ação.
 *
 * ## Por que a forma, e não a lista de apps
 *
 * A detecção é por **formato** — `algo:resto` onde `algo` não é o nosso slug.
 * Listar os slugs dos outros produtos aqui faria `npm run audit:isolation`
 * falhar, e com razão: nenhum app pode citar o identificador de outro.
 *
 * Cuid não tem dois-pontos, então uma referência sem marca é inequivocamente
 * legado — e legado só existe onde já havia cobrança antes desta marca.
 */

/**
 * O slug deste app. Vazio fora do Worker (dev), onde não há outro app.
 *
 * **Função, e não `const`** — e isto é a correção de um deploy reprovado em
 * 14/11. `APP()` chama `BRAND()`, que é fail-fast: num `const` de nível de
 * módulo ele roda quando a Cloudflare AVALIA o script para validá-lo, antes de
 * existir requisição e portanto antes de alguém registrar a marca. O build
 * compilava inteiro e a publicação morria com `MarcaNaoRegistradaError`.
 *
 * O cache existe porque `APP()` já é memoizado, mas o slug é lido em todo
 * `marcarReferencia` e não há razão para reatravessar a camada de config.
 */
let slugCache: string | null = null
function SLUG(): string {
    if (slugCache === null) slugCache = APP().slug
    return slugCache
}

/** `<slug>:cus_123` — e `cus_123` cru quando não há slug (dev). */
export function marcarReferencia(id: string): string {
    const slug = SLUG()
    return slug ? `${slug}:${id}` : id
}

export type LeituraDeReferencia =
    | { tipo: 'nossa'; id: string }
    /** Marcada por outro produto na mesma conta Asaas. Não é nossa, e sabemos disso. */
    | { tipo: 'de-outro-app' }
    /** Sem marca: anterior a esta mudança, ou criada à mão no painel. */
    | { tipo: 'sem-marca'; id: string }

const MARCA = /^([a-z][a-z0-9-]{1,30}):(.+)$/

export function lerReferencia(ref: string | null | undefined): LeituraDeReferencia | null {
    if (!ref) return null

    const casa = MARCA.exec(ref)
    if (!casa) return { tipo: 'sem-marca', id: ref }

    const [, slug, id] = casa
    // Sem slug configurado (dev) tudo que está marcado é tratado como nosso: em
    // dev não existe o outro app para confundir, e recusar aqui quebraria o
    // caminho local sem proteger nada.
    const nosso = SLUG()
    if (!nosso || slug === nosso) return { tipo: 'nossa', id }
    return { tipo: 'de-outro-app' }
}

/** Atalho para o caso que interessa a quem decide ignorar um evento. */
export function deOutroApp(ref: string | null | undefined): boolean {
    return lerReferencia(ref)?.tipo === 'de-outro-app'
}
