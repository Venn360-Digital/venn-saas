import { acharDocumento, type DocumentoDeTreinamento, type ModoDoDocumento } from './documentos'
import type { RagDocType } from '@/lib/queue/definitions'
import { semComentarios } from '@/lib/rag/secoes'
import { semExemplos } from './exemplos'

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

/** O tipo dos trechos de um documento de **procedimento**. Ver `RagDocType`. */
export const TIPO_DE_CENARIO = 'cenario'

/**
 * Os tipos que vêm de **documento de treinamento**, os dois.
 *
 * Existe porque três lugares perguntam "este trecho é de treinamento?" e a
 * resposta deixou de ser uma comparação simples quando `cenario` apareceu:
 *
 *   - a aba Cérebro lista o que **não** é de treinamento, e apagar por lá um
 *     trecho de treinamento deixaria `indexedChunks` dizendo "34 trechos" com
 *     zero no banco;
 *   - a medição de recuperação marca quais trechos vieram do treinamento.
 *
 * Com um array, somar um terceiro modo no futuro é somar um item aqui — e os
 * três lugares acompanham.
 */
export const TIPOS_DE_TREINAMENTO = [TIPO_DE_TREINAMENTO, TIPO_DE_CENARIO] as const

/** O trecho veio de um documento de treinamento? */
export function ehDeTreinamento(type: string): boolean {
    return (TIPOS_DE_TREINAMENTO as readonly string[]).includes(type)
}

/**
 * Qual tipo os trechos deste documento levam.
 *
 * É o que separa fato de procedimento no acervo — e a separação acontece aqui,
 * na indexação, porque o prompt precisa dela **na recuperação**, quando já não há
 * como saber de que documento o trecho veio sem uma segunda consulta.
 */
export function tipoDoAcervo(modo: ModoDoDocumento): RagDocType {
    return modo === 'procedimento' ? TIPO_DE_CENARIO : TIPO_DE_TREINAMENTO
}

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

export interface TextoDoAcervo {
    /** O que de fato vai ser cortado e vetorizado. */
    texto: string
    /** Títulos das seções de exemplo que ficaram fora. */
    exemplosRetirados: string[]
}

/**
 * O texto que vai para o acervo — **a mesma normalização nos dois lados**.
 *
 * Existe porque a rota e o processador normalizavam diferente, e a diferença
 * fazia o carimbo de "já indexado" comparar maçã com laranja:
 *
 *   - a rota hasheava o conteúdo cru (só `trim`), enquanto o processador
 *     hasheava o conteúdo **sem comentários de HTML**. Documento com um
 *     `<!-- confirmar -->` dentro nunca batia, então `decidirIndexacao`
 *     respondia "indexar" a cada salvar e enfileirava um job por gravação, para
 *     o processador descobrir no fim que nada havia mudado;
 *   - e agora as seções de exemplo também saem do acervo, o que abriria uma
 *     segunda divergência pela mesma porta.
 *
 * Com uma função só, `pular: inalterado` volta a ser verdade e o job só nasce
 * quando há texto novo para vetorizar.
 */
export function textoParaAcervo(content: string): TextoDoAcervo {
    const { fatos, retiradas } = semExemplos(semComentarios(content))
    return { texto: fatos.trim(), exemplosRetirados: retiradas }
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
    /**
     * Documento de comportamento vai no prompt, não no acervo.
     *
     * **Com trechos gravados, porém, a ação é apagar — e isto foi um defeito.**
     * Quando um documento muda de `rag` para `prompt`, o modo novo diz "não
     * indexe", mas os trechos da indexação anterior continuam lá: o mesmo texto
     * passa a chegar ao modelo **duas vezes** — inteiro no prompt e em pedaços
     * pelo acervo — e os pedaços ainda ocupam vaga de recuperação que outro
     * documento precisava.
     *
     * Aconteceu de verdade em 2026-10-29, quando `empresa` e `tecnicas-de-venda`
     * mudaram de modo com 7 e 13 trechos indexados. Sem isto, a troca de modo
     * seria silenciosamente pela metade.
     */
    if (entrada.doc.modo === 'prompt') {
        return entrada.hashGravado ? { acao: 'apagar' } : { acao: 'pular', motivo: 'modo-prompt' }
    }

    const { texto: conteudo } = textoParaAcervo(entrada.content)

    /**
     * Esvaziado: os trechos da geração anterior têm de sair, senão o agente
     * continua respondendo pelo que a conta acabou de apagar.
     *
     * "Vazio" aqui é vazio **para o acervo**: documento que só tem comentário de
     * quem escreve, ou só a seção de exemplos, não tem fato nenhum a indexar.
     */
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
