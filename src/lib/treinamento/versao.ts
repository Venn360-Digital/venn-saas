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
 * O estado do acervo de um documento, com os dois hashes já calculados.
 *
 * Separado de `DocumentoComRascunho` de propósito: hashear é assíncrono
 * (`crypto.subtle`) e é trabalho de quem lê o banco. Aqui só se compara — a
 * decisão continua pura e testável em Node.
 */
export interface AcervoDoDocumento {
    slug: string
    /** Entra no acervo? Documento de modo `prompt` vai no prompt, não é indexado. */
    ehAcervo: boolean
    /** O hash do que está indexado hoje (`indexedHash`). Nulo: nunca indexou. */
    indexado: string | null
    /**
     * O hash do texto de acervo que o conteúdo **publicado** daria agora.
     * Nulo quando não daria texto nenhum — documento só com comentário, só com a
     * seção de exemplos, ou vazio.
     */
    agora: string | null
}

/**
 * Quais slugs estão com o acervo atrasado: **o que está indexado não é o que
 * seria indexado agora.**
 *
 * ## O defeito que isto conserta
 *
 * `slugsQueMudam` só vê "rascunho ≠ publicado", e isso cobre mudança de
 * **texto**. Mas o texto não é a única coisa que decide o que vai para o acervo:
 * `textoParaAcervo` decide também, e ela é código. Quando o código muda, todo
 * documento já indexado fica obsoleto **sem que ninguém tenha editado nada** — e
 * sem rascunho pendente a tela não tinha como reindexar.
 *
 * Aconteceu em 2026-10-31: o conserto de `ehSecaoDeExemplos` passou a retirar do
 * acervo seções tituladas "Exemplos ou sugestões de resposta". Na conta de teste
 * a tela mostrava os dois números lado a lado — "indexado em 10 trechos" contra
 * "8 trechos" — e o botão dizia "Publicar 1 mudança", ignorando os dois
 * documentos obsoletos. Três diálogos de exemplo seguiram sendo servidos ao
 * modelo como fonte de verdade, e só saíram por um truque no banco
 * (`draftContent = content || E'\n'`, para a publicação enxergar uma mudança).
 *
 * ## Por que só quem JÁ foi indexado
 *
 * `indexado !== null` é a guarda que impede isto de virar "reindexe o acervo
 * inteiro":
 *
 *   - documento **nunca indexado** com texto publicado está em outro estado —
 *     ou o job está em voo (toda publicação passa por aí por alguns segundos, e
 *     entrar aqui acenderia um "reindexar" falso logo depois de publicar), ou o
 *     job falhou. A tela já diz isso em outra frase, e reindexar não é o
 *     remédio;
 *   - documento de modo `prompt` não tem acervo: ele vai inteiro no prompt, e
 *     comparar hash de algo que nunca foi vetorizado não quer dizer nada.
 *
 * `agora` nulo com `indexado` preenchido **conta**, e é o caso mais grave: há
 * trechos no acervo para um texto que hoje não renderia trecho nenhum. O agente
 * responde pelo que já não existe.
 */
export function slugsDesatualizados(docs: AcervoDoDocumento[]): string[] {
    return docs
        .filter((d) => d.ehAcervo && d.indexado !== null && d.indexado !== d.agora)
        .map((d) => d.slug)
}

/**
 * Os documentos que **deixaram de ser acervo** e têm trechos para trás.
 *
 * É a outra metade de `slugsDesatualizados`, e nasceu da troca de modo de
 * `servicos` e `faq` em 2026-11-12. As duas funções olham para a mesma dupla de
 * campos e separam dois estados que não se confundem:
 *
 *   - **desatualizado** é acervo cujo texto andou: reindexar;
 *   - **resíduo** é quem não é mais acervo e ainda tem trechos: apagar.
 *
 * Existe por uma razão concreta: o `publicar` recusa com 409 quando não há
 * rascunho pendente nem acervo atrasado. Uma conta que não editou nada depois do
 * deploy cairia nesse 409 **para sempre**, com os trechos antigos vivos no
 * acervo — o mesmo texto chegando ao modelo duas vezes, inteiro pelo prompt e em
 * pedaços pela busca, e os pedaços tomando vaga de recuperação de outro
 * documento. Contar o resíduo como motivo é o que torna a limpeza alcançável
 * pelo botão que a conta já usa.
 *
 * `indexado !== null` é a mesma guarda da outra função: documento de modo
 * `prompt` que nunca foi vetorizado não tem nada a limpar, e é o caso de quase
 * todos.
 */
export function slugsComResiduoDeAcervo(docs: AcervoDoDocumento[]): string[] {
    return docs.filter((d) => !d.ehAcervo && d.indexado !== null).map((d) => d.slug)
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
