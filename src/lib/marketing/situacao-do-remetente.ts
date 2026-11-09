/**
 * Que situação gravar para um domínio depois de perguntar ao SES.
 *
 * ## Por que num módulo próprio, e não junto do mapa de rótulos
 *
 * Porque **o Worker importa isto**, e o mapa não. `SITUACAO_DO_REMETENTE` vive em
 * `remetentes.ts`, que importa `ToneEntry` de um componente `.tsx`; a rotina
 * `ses-verificar-remetente` roda dentro do Worker, cujo `tsconfig` não tem
 * `jsx` ligado de propósito (os tipos da Cloudflare redefinem globais
 * incompatíveis com a `lib: dom` do app).
 *
 * Deixar as duas coisas no mesmo arquivo fez `npm run typecheck:cloudflare`
 * reprovar com `'--jsx' is not set` — um tipo de tela entrando no grafo de
 * import do Worker por tabela de cor. Zero imports aqui é o que mantém essa
 * fronteira.
 *
 * ## Por que é pura
 *
 * **Dois** caminhos perguntam ao SES: a rotina de hora em hora e o botão
 * "Verificar agora" da ficha do domínio. A decisão escrita nos dois lugares
 * divergiria, e a divergência apareceria como "o botão diz uma coisa e a tela
 * mostra outra".
 */

/** O estado da identidade, como o SES o devolve. */
export interface IdentidadeDoSes {
    prontaParaEnvio: boolean
    dkimStatus: string | null
}

export type SituacaoDoRemetente = 'pending' | 'verified' | 'failed'

/**
 * `venceu` é o que separa os dois caminhos.
 *
 * Ele vale **só para o cron**, que o usa para parar de perguntar por domínio
 * abandonado há uma semana. No botão é sempre `false`: quem clica está mexendo
 * no DNS naquele instante, e recusar o domínio porque passaram sete dias seria
 * hostil exatamente na hora em que a pessoa está consertando.
 *
 * `TEMPORARY_FAILURE` cai em `pending` por omissão, e isso é desenho: ele
 * significa "o DNS ainda não propagou, espere", não "está errado". Tratá-lo como
 * recusa mandaria o cliente mexer num registro que está certo.
 */
export function situacaoDoRemetente(
    identidade: IdentidadeDoSes,
    venceu: boolean
): SituacaoDoRemetente {
    if (identidade.prontaParaEnvio) return 'verified'
    if (identidade.dkimStatus === 'FAILED') return 'failed'
    return venceu ? 'failed' : 'pending'
}
