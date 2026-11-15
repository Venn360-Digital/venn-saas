import 'server-only'

/**
 * A classificação do dado, e o destino que ela determina.
 *
 * Esta é a peça que o R2 **sozinho** não pode cumprir. A Cloudflare documenta
 * que a localização dos objetos no R2 é decidida automaticamente e que os
 * *Location Hints* são dica, não garantia — e os dois buckets criados em
 * 2026-10-21 nasceram em `ENAM` (leste da América do Norte), o que confirma a
 * leitura na prática. Para arquivo clínico identificável, "provavelmente está no
 * Brasil" não é uma frase que se possa dizer a uma clínica.
 *
 * Então o roteamento é **pela classe do dado**, nunca pelo chamador. Quem chama
 * declara o que o arquivo é; o adaptador decide onde ele pode morar. O caminho
 * inverso — cada rota escolhendo seu bucket — é como arquivo de paciente acaba
 * no lugar errado, porque basta uma rota nova copiar a linha da vizinha.
 */
export const CLASSES = {
    /**
     * Público de verdade: serve-se por URL sem autenticação e não identifica
     * ninguém. Avatar de agente, prévia de voz, ativo de marca.
     */
    PUBLICO: 'publico',

    /**
     * Clínico ou pessoal identificável. Mídia de conversa (foto, áudio,
     * documento de paciente) e a nota de voz que o agente gera, que **deriva**
     * do conteúdo da conversa e por isso herda a classe.
     */
    CLINICO: 'clinico',

    /**
     * Ainda não classificado. Documento de base de conhecimento entra aqui até
     * alguém dizer o que ele é: a clínica sobe tanto folheto de servico
     * quanto laudo.
     *
     * **Bloqueia a gravação.** Não é o mesmo que `CLINICO`: tratar o não
     * classificado como clínico pareceria seguro e esconderia o problema, porque
     * o arquivo seria aceito e ninguém voltaria para classificá-lo.
     */
    NAO_CLASSIFICADO: 'nao-classificado',
} as const

export type Classe = (typeof CLASSES)[keyof typeof CLASSES]

/**
 * Onde cada classe pode morar.
 *
 * Os dois são R2 — a divisão é de **bucket**, não de empresa. Decisão do André
 * em 2026-10-21: `odontobox-public` e `odontobox-private`.
 *
 * O nome diz `r2-` nos dois de propósito, para que ninguém leia `privado` como
 * "em outro provedor, com residência no Brasil". Os buckets nasceram em `ENAM`
 * — o R2 não tem região na América do Sul.
 */
export type NomeDeProvedor = 'r2-publico' | 'r2-privado'

export class ClasseBloqueadaError extends Error {
    readonly classe: Classe

    constructor(classe: Classe, motivo: string) {
        super(`a classe "${classe}" não pode ser gravada: ${motivo}`)
        this.name = 'ClasseBloqueadaError'
        this.classe = classe
    }
}

/**
 * O provedor de uma classe — ou a recusa, com o motivo.
 *
 * **`CLINICO` deixou de ser bloqueio em 2026-10-21, por decisão do André:** o
 * clínico vai para o R2, no bucket `odontobox-private`. A alternativa com
 * residência brasileira (Magalu Cloud `br-se1`, em
 * `docs/migration/00-storage-brasil-options.md`) foi avaliada e recusada.
 *
 * O que isso significa, registrado para quem ler depois: **o arquivo clínico
 * não fica no Brasil.** O R2 não tem região na América do Sul — as localizações
 * são `wnam`, `enam`, `weur`, `eeur`, `apac` e `oc` — e não existe jurisdição
 * `br` em Jurisdictional Restrictions (há `eu`, `us` e `fedramp`). Os dois
 * buckets nasceram em `ENAM`, o que a própria API devolveu na criação.
 *
 * O controle que sustenta a decisão, portanto, **não é localização, é cifra**:
 * ver a pendência de cifrar na aplicação antes do `put`, com a chave em
 * Cloudflare Secrets, fora do bucket. Ainda **não implementada**.
 *
 * `NAO_CLASSIFICADO` segue bloqueado, e por outro motivo — disciplina de
 * classificação, não residência.
 */
export function provedorDa(classe: Classe): NomeDeProvedor {
    switch (classe) {
        case CLASSES.PUBLICO:
            return 'r2-publico'

        case CLASSES.CLINICO:
            return 'r2-privado'

        case CLASSES.NAO_CLASSIFICADO:
            throw new ClasseBloqueadaError(
                classe,
                'classifique o arquivo antes de gravá-lo; não classificado não é o mesmo que público'
            )
    }
}

/** Se a classe pode ser gravada hoje. Não lança — para a tela poder perguntar. */
export function podeGravar(classe: Classe): boolean {
    try {
        provedorDa(classe)
        return true
    } catch {
        return false
    }
}
