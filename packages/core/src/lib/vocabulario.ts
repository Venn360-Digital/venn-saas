import type { Brand } from '@venn/config/marca'

import { BRAND } from '../marca'

/**
 * As palavras do nicho, em duas camadas: o padrão da marca e o ajuste da
 * unidade.
 *
 * ## Por que duas, e não só a marca
 *
 * A camada da marca (`BRAND().vocabulario`) é obrigatória porque fila, cron,
 * e-mail e prompt de IA rodam **fora de requisição** — não há unidade conhecida
 * ali, e o texto ainda precisa sair certo. A camada da unidade existe porque
 * nicho não é uma palavra só: uma clínica escreve "paciente", um estúdio do
 * mesmo ramo escreve "cliente", e hoje a única saída deles seria pedir um app
 * novo.
 *
 * Mora em `Workspace.settings` (`Json?`), que o schema já documenta como "Tema,
 * idioma, fuso horário" e que o fuso já usa — mesma escolha, mesmo motivo:
 * a produção dos apps irmãos ainda não tem caminho para rodar migração.
 *
 * ## Nunca lança, e nunca devolve palavra vazia
 *
 * Isto é lido no caminho de renderizar tela, de montar prompt e de escrever
 * e-mail. Um `settings` corrompido, um campo com número no lugar de texto, uma
 * string vazia — tudo cai no padrão da marca, que é o comportamento de antes
 * desta coluna ser lida. Texto em branco numa tela é pior que a palavra do
 * nicho errado.
 *
 * ## `BRAND()` é fail-fast: não chame isto em nível de módulo
 *
 * `vocab()` lê a marca, e a marca lança se ninguém a registrou. Um
 * `const ROTULO = vocab().pessoa` no topo de um módulo é avaliado quando a
 * Cloudflare VALIDA o script, antes de qualquer registro — e reprova a
 * publicação com `MarcaNaoRegistradaError`. Aconteceu seis vezes nesta fase.
 * Chame dentro da função que usa o texto.
 */
export type Vocabulario = Brand['vocabulario']

/** A chave dentro de `Workspace.settings`. */
const CHAVE = 'vocabulario'

/**
 * Os campos que a unidade pode ajustar, DERIVADOS da marca registrada.
 *
 * Era uma lista escrita à mão em paralelo ao contrato, e isso é a armadilha que
 * esta fase passou o dia inteiro encontrando em seis formas: lista de nomes
 * mantida à mão diverge do código, e **diverge calada**. Acrescentar um eixo ao
 * contrato e esquecer desta linha faria o override daquele campo ser descartado
 * sem erro nenhum — a tela mostraria o padrão e a pessoa veria o Salvar
 * funcionar sem efeito.
 *
 * As chaves de `BRAND().vocabulario` são exatamente o que o contrato declara,
 * porque é o objeto que o satisfaz. É o critério que o runtime usa.
 *
 * Função, não constante: `BRAND()` lança se ninguém registrou a marca, e um
 * `const` aqui seria avaliado quando a Cloudflare valida o script.
 */
function campos(): PalavraDoNicho[] {
    const v = BRAND().vocabulario as Record<string, unknown>
    /*
     * Só as chaves de TEXTO. `genero` entrou no contrato e é um objeto, não uma
     * palavra — sem este filtro a unidade poderia gravar `genero: "x"` pelo
     * override e quebrar a concordância de todas as frases. O filtro é pelo
     * TIPO do valor, não por uma lista de exceções que alguém manteria à mão.
     */
    return Object.keys(v).filter((k) => typeof v[k] === 'string') as PalavraDoNicho[]
}

/** As chaves de `vocabulario` que são palavra, e não a tabela de gênero. */
export type PalavraDoNicho = {
    [K in keyof Vocabulario]: Vocabulario[K] extends string ? K : never
}[keyof Vocabulario]

/**
 * Uma palavra só vale se for texto não vazio e curto.
 *
 * O teto existe porque isto vai para `<title>`, assunto de e-mail e prompt: um
 * campo de 10 mil caracteres gravado por engano (ou de propósito) viraria
 * injeção de texto no prompt do agente e cabeçalho de e-mail inválido. 40 é
 * folgado para qualquer substantivo — "profissional de saúde bucal" tem 27.
 */
const TETO = 40
function palavraValida(v: unknown): v is string {
    return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= TETO
}

/** O override da unidade, só com os campos válidos. */
export function lerVocabularioDasConfiguracoes(settings: unknown): Partial<Record<PalavraDoNicho, string>> {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {}
    const bruto = (settings as Record<string, unknown>)[CHAVE]
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return {}
    const lido = bruto as Record<string, unknown>
    const saida: Partial<Record<PalavraDoNicho, string>> = {}
    for (const campo of campos()) {
        const v = lido[campo]
        if (palavraValida(v)) saida[campo] = v.trim()
    }
    return saida
}

/**
 * O vocabulário a usar: o ajuste da unidade sobre o padrão da marca.
 *
 * Sem argumento (fila, cron, e-mail, prompt) devolve o padrão da marca — que é
 * o que esses caminhos sempre tiveram.
 */
export function vocab(settings?: unknown): Vocabulario {
    const padrao = BRAND().vocabulario
    if (settings === undefined) return padrao
    return { ...padrao, ...lerVocabularioDasConfiguracoes(settings) }
}

/** Se a unidade **declarou** alguma palavra, em vez de estar toda no padrão. */
export function temVocabularioNasConfiguracoes(settings: unknown): boolean {
    return Object.keys(lerVocabularioDasConfiguracoes(settings)).length > 0
}

/**
 * O que gravar de volta em `settings`, preservando o resto.
 *
 * Campo apagado (string vazia) **remove** o override em vez de gravar vazio —
 * é como a tela devolve a palavra ao padrão da marca.
 */
export function comVocabularioNasConfiguracoes(
    settings: unknown,
    ajuste: Partial<Record<PalavraDoNicho, string>>
): Record<string, unknown> {
    const base =
        settings && typeof settings === 'object' && !Array.isArray(settings)
            ? { ...(settings as Record<string, unknown>) }
            : {}
    const atual = lerVocabularioDasConfiguracoes(settings)
    for (const campo of campos()) {
        if (!(campo in ajuste)) continue
        const v = ajuste[campo]
        if (palavraValida(v)) atual[campo] = v.trim()
        else delete atual[campo]
    }
    if (Object.keys(atual).length === 0) delete base[CHAVE]
    else base[CHAVE] = atual
    return base
}
