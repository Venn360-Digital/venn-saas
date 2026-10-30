/**
 * Rascunho, publicado, e a volta atrás.
 *
 * Parte pura: decide o que muda ao publicar e o que voltar ao desfazer. Quem
 * grava é a rota de publicação.
 *
 * ## Por que versionar, e por que o mínimo basta
 *
 * O laço de melhoria do estudo (§3.8) não funciona sem duas versões na mesa: a
 * medição compara **rascunho contra publicado**, o juiz pareado precisa de dois
 * candidatos, e "piorou" só existe se houver um "antes". Sem versão, toda
 * mudança de treinamento é uma aposta.
 *
 * Mas versionar de menos é melhor do que versionar de mais. O que **não** é
 * versionado, de propósito:
 *
 *   - **os trechos do acervo.** Eles são derivados do texto; guardar geração
 *     antiga de embedding dobraria a tabela e o custo para reconstruir algo que
 *     a reindexação reconstrói de graça;
 *   - **cada tecla.** Rascunho é um campo, não um histórico. Quem quer histórico
 *     de edição quer outra coisa (auditoria), e não é isto;
 *   - **versão por documento.** A versão é **do agente**: os sete documentos se
 *     contradizem entre si por desenho (há precedência declarada entre eles), e
 *     comparar "Serviços v3 com Processo v1" compararia um agente que nunca
 *     existiu.
 */

/** Um documento dentro de um instantâneo: o slug e o texto que estava no ar. */
export interface DocumentoNoInstantaneo {
    slug: string
    content: string
}

export interface DocumentoComRascunho {
    slug: string
    /** O que está no ar. */
    content: string
    /** O que foi escrito e ainda não publicado. Nulo quando não há rascunho. */
    draftContent: string | null
}

/**
 * Quais slugs mudariam ao publicar.
 *
 * Rascunho **idêntico** ao publicado não conta: a tela grava rascunho a cada
 * salvar, e salvar sem mudar nada não pode produzir uma versão nova nem
 * reenfileirar indexação. É o mesmo raciocínio do hash do indexador.
 */
export function slugsQueMudam(docs: DocumentoComRascunho[]): string[] {
    return docs
        .filter((d) => d.draftContent !== null && d.draftContent !== d.content)
        .map((d) => d.slug)
}

/** Há algo para publicar? */
export function temRascunhoPendente(docs: DocumentoComRascunho[]): boolean {
    return slugsQueMudam(docs).length > 0
}

/**
 * O estado publicado depois de aplicar os rascunhos.
 *
 * Devolve **todos** os documentos, não só os que mudaram: é o instantâneo da
 * versão, e um instantâneo pela metade não serve para voltar atrás. Documento
 * sem rascunho entra com o texto que já estava no ar.
 */
export function aplicarRascunhos(docs: DocumentoComRascunho[]): DocumentoNoInstantaneo[] {
    return docs.map((d) => ({
        slug: d.slug,
        content: d.draftContent !== null && d.draftContent !== d.content ? d.draftContent : d.content,
    }))
}

/**
 * A próxima versão. Começa em 1: **a versão 0 é "nunca publicou"**.
 *
 * Importa para a medição: um agente na versão 0 não tem com o que comparar, e a
 * tela tem de dizer isso em vez de mostrar um delta contra o vazio.
 */
export function proximaVersao(atual: number): number {
    return Math.max(0, Math.floor(atual)) + 1
}

/**
 * O que restaurar ao voltar para uma versão.
 *
 * Volta **como rascunho**, nunca direto para o publicado. Desfazer é uma
 * proposta como qualquer outra: quem voltou olha, mede e publica. Restaurar
 * direto no ar faria a volta atrás ser a única mudança de treinamento que entra
 * sem número — exatamente o que o princípio 5 do estudo proíbe.
 */
export function rascunhosDaRestauracao(
    instantaneo: DocumentoNoInstantaneo[],
    atuais: DocumentoComRascunho[]
): { slug: string; draftContent: string }[] {
    const noAr = new Map(atuais.map((d) => [d.slug, d.content]))

    return instantaneo
        // Restaurar o que já está idêntico no ar seria criar rascunho que não
        // propõe nada — e a tela mostraria "há mudanças para publicar" mentindo.
        .filter((d) => noAr.get(d.slug) !== d.content)
        .map((d) => ({ slug: d.slug, draftContent: d.content }))
}
