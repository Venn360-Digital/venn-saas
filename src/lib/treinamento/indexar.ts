import { acharDocumento, type DocumentoDeTreinamento } from './documentos'

/**
 * Quando um documento de treinamento precisa ser reindexado, e com que nome.
 *
 * Parte pura: decide, não executa. Quem executa é a rota que grava o documento
 * e o processador da fila.
 */

/**
 * O `type` dos trechos de treinamento em `knowledge_documents`.
 *
 * Tipo próprio, e não `doc`, por uma razão de tela: o Cérebro lista as fontes
 * agrupadas por `type::title` **sem filtrar tipo**, e o DELETE dele apaga por
 * essa mesma chave. Com tipo próprio dá para a aba Cérebro ignorar o que não é
 * dela — e dá para o DELETE recusar. Sem isso, apagar um documento de
 * treinamento pela tela do Cérebro tiraria os trechos e deixaria
 * `indexedChunks` dizendo "34 trechos" com zero no banco.
 */
export const TIPO_DE_TREINAMENTO = 'treinamento'

/**
 * O título dos trechos é o **slug**, não o título humano.
 *
 * `replaceExisting` deduplica por `(agentId, title)`: é apagando por título que
 * a reindexação remove a geração anterior. Título humano muda — "Serviços
 * prestados" pode virar "Nossos serviços" —, e no primeiro rename os trechos
 * velhos ficariam órfãos, invisíveis para a substituição e eternos na busca.
 *
 * A legibilidade não se perde: o corte por cabeçalho cola o caminho da seção no
 * texto do trecho, e o `# Título` do documento é o primeiro elemento desse
 * caminho. O modelo lê "Serviços prestados › Ortodontia › Preço" de qualquer
 * forma.
 */
export function tituloDoAcervo(slug: string): string {
    return slug
}

export type AcaoDeIndexacao =
    /** Vetorizar: é documento de acervo, com conteúdo, e o conteúdo mudou. */
    | { acao: 'indexar'; hash: string }
    /** Apagar os trechos: o documento foi esvaziado. */
    | { acao: 'apagar' }
    /** Nada a fazer, com o porquê — é o que a tela mostra. */
    | { acao: 'pular'; motivo: 'modo-prompt' | 'sem-conteudo' | 'inalterado' }

/**
 * O SHA-256 do conteúdo, em hexadecimal.
 *
 * `crypto.subtle` e não `node:crypto`: é o que existe no Worker **e** no Node,
 * então a mesma função serve à rota e ao teste. Assíncrona por isso.
 */
export async function hashDoConteudo(content: string): Promise<string> {
    const bytes = new TextEncoder().encode(content)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Decide o que fazer com um documento que acabou de ser gravado.
 *
 * O `hashGravado` é o do último conteúdo indexado (`indexedHash`). Comparar com
 * o hash do conteúdo atual é o que evita **pagar embedding do acervo inteiro a
 * cada salvar**: a tela salva os sete documentos juntos, e sem esta comparação
 * mexer numa vírgula de um reindexaria todos — sete vezes o custo e sete vezes
 * a espera, a cada gravação.
 */
export async function decidirIndexacao(entrada: {
    doc: DocumentoDeTreinamento
    content: string
    hashGravado: string | null
}): Promise<AcaoDeIndexacao> {
    // Documento de comportamento vai no prompt, não no acervo. Não é pendência
    // de indexação: é o modo dele.
    if (entrada.doc.modo === 'prompt') return { acao: 'pular', motivo: 'modo-prompt' }

    const conteudo = entrada.content.trim()

    // Esvaziado: os trechos da geração anterior têm de sair, senão o agente
    // continua respondendo pelo que a conta acabou de apagar.
    if (conteudo.length === 0) {
        return entrada.hashGravado ? { acao: 'apagar' } : { acao: 'pular', motivo: 'sem-conteudo' }
    }

    const hash = await hashDoConteudo(conteudo)
    if (hash === entrada.hashGravado) return { acao: 'pular', motivo: 'inalterado' }

    return { acao: 'indexar', hash }
}

/** O slug é válido quando o catálogo o conhece. Rota não aceita slug inventado. */
export function slugConhecido(slug: string): boolean {
    return acharDocumento(slug) !== undefined
}
