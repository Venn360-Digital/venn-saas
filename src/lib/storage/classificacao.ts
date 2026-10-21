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
     * alguém dizer o que ele é: a clínica sobe tanto folheto de procedimento
     * quanto laudo.
     *
     * **Bloqueia a gravação.** Não é o mesmo que `CLINICO`: tratar o não
     * classificado como clínico pareceria seguro e esconderia o problema, porque
     * o arquivo seria aceito e ninguém voltaria para classificá-lo.
     */
    NAO_CLASSIFICADO: 'nao-classificado',
} as const

export type Classe = (typeof CLASSES)[keyof typeof CLASSES]

/** Onde cada classe pode morar. */
export type NomeDeProvedor = 'r2' | 'brasil'

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
 * `CLINICO` está bloqueado por **decisão pendente**, não por defeito: o provedor
 * com residência contratual no Brasil está recomendado (Magalu Cloud `br-se1`) e
 * aguarda aprovação. Ver `docs/migration/00-storage-brasil-options.md`.
 *
 * Enquanto isso, a cópia na VPS segue sendo a fonte desses arquivos, e tentar
 * gravar lança — em vez de cair no R2 por omissão, que é o modo de falha que
 * este módulo existe para impedir.
 */
export function provedorDa(classe: Classe): NomeDeProvedor {
    switch (classe) {
        case CLASSES.PUBLICO:
            return 'r2'

        case CLASSES.CLINICO:
            throw new ClasseBloqueadaError(
                classe,
                'o provedor com residência no Brasil ainda não foi aprovado; ' +
                    'a cópia atual permanece a fonte e o R2 não garante residência física'
            )

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
