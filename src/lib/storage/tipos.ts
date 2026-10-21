import 'server-only'
import type { Classe, NomeDeProvedor } from './classificacao'

/**
 * A referência a um objeto guardado — o que vai para o Postgres.
 *
 * **Nunca URL.** Hoje as três services do worker gravam o retorno de
 * `getPublicUrl()` numa coluna, e `agents/[id]/avatar` grava a URL com um
 * `?v=` grudado para furar cache. Isso amarra o banco ao provedor: trocar de
 * provedor passaria a exigir reescrever linhas, e URL assinada guardada é pior
 * ainda, porque ela expira e a coluna fica apontando para um 403.
 *
 * O banco guarda o endereço lógico; a URL é derivada na hora de servir, pelo
 * provedor que a classe determina.
 */
export interface Referencia {
    provedor: NomeDeProvedor
    bucket: string
    chave: string
    classe: Classe
    contentType: string
    /** Bytes. Para a tela poder decidir se mostra ou oferece download. */
    tamanho?: number
}

export interface OpcoesDeGravacao {
    contentType: string
    /** Sobrescrever se a chave já existir. Falso por omissão. */
    substituir?: boolean
}

/**
 * O contrato mínimo de um provedor de objetos.
 *
 * Mínimo de propósito: é o que a aplicação realmente usa hoje — oito pontos de
 * chamada, medidos — mais a URL assinada que o conteúdo sensível vai exigir.
 * Qualquer coisa além disto vira dependência de um recurso que um dos dois
 * provedores pode não ter, e a Magalu já não documenta SSE-C/SSE-KMS.
 */
export interface ProvedorDeObjetos {
    readonly nome: NomeDeProvedor

    gravar(
        bucket: string,
        chave: string,
        corpo: Uint8Array<ArrayBuffer>,
        opcoes: OpcoesDeGravacao
    ): Promise<void>
    ler(bucket: string, chave: string): Promise<Uint8Array<ArrayBuffer> | null>
    apagar(bucket: string, chave: string): Promise<void>
    existe(bucket: string, chave: string): Promise<boolean>
    /** URL de validade curta. Segundos. */
    urlAssinada(bucket: string, chave: string, validadeSegundos: number): Promise<string>
}

export class ObjetoAusenteError extends Error {
    constructor(bucket: string, chave: string) {
        super(`objeto não encontrado: ${bucket}/${chave}`)
        this.name = 'ObjetoAusenteError'
    }
}

/**
 * A chave de um objeto, sempre começando pelo workspace.
 *
 * O prefixo de workspace não é organização: é a fronteira de inquilino
 * espelhada no storage, e é o que permite conferir autorização olhando só a
 * chave. Os pontos de chamada atuais já fazem isso à mão
 * (`${workspaceId}/${conversationId}/…`); aqui passa a ser a única forma de
 * montar chave, para que uma rota nova não possa esquecer.
 */
export function chaveDe(workspaceId: string, ...partes: string[]): string {
    const inquilino = workspaceId.trim()

    if (!inquilino) {
        throw new Error('chave de objeto sem workspaceId; a fronteira de inquilino é obrigatória')
    }

    /**
     * O prefixo de inquilino é validado como as outras partes.
     *
     * Hoje ele sempre vem de `getWorkspaceMember()`, resolvido no servidor
     * contra o banco — então não há caminho pelo qual um valor com `..` ou `/`
     * chegue aqui. A conferência existe porque essa garantia é de **hoje**: a
     * função aceita uma string, e o dia em que alguém a chamar com um id vindo
     * de corpo de requisição ela precisa recusar sozinha, em vez de confiar que
     * o chamador conferiu. É a parte que define a fronteira; é a última que deve
     * depender de boa-fé.
     */
    if (inquilino.includes('/') || inquilino.includes('..')) {
        throw new Error(`workspaceId inválido para chave de objeto: "${inquilino}"`)
    }

    const limpas = partes
        .map((p) => p.trim().replace(/^\/+|\/+$/g, ''))
        .filter((p) => p.length > 0)

    if (limpas.length === 0) throw new Error('chave de objeto sem nenhuma parte além do workspace')

    /**
     * `..` é recusado em vez de normalizado.
     *
     * Normalizar silenciosamente aceitaria uma chave construída para escapar do
     * prefixo e devolveria outra, o que esconde a tentativa. Recusar deixa o
     * defeito aparecer onde ele nasceu.
     */
    for (const parte of limpas) {
        if (parte === '..' || parte.includes('../') || parte.includes('/..')) {
            throw new Error(`parte de chave inválida: "${parte}"`)
        }
    }

    return [inquilino, ...limpas].join('/')
}
