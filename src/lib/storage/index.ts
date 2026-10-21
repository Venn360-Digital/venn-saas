import 'server-only'
import { CLASSES, ClasseBloqueadaError, provedorDa, podeGravar, type Classe, type NomeDeProvedor } from './classificacao'
import { ProvedorS3 } from './s3'
import { ObjetoAusenteError, chaveDe, type OpcoesDeGravacao, type ProvedorDeObjetos, type Referencia } from './tipos'

/**
 * O adaptador de storage da aplicação.
 *
 * Substitui o Supabase Storage, que até 2026-10-21 era chamado direto em oito
 * pontos — e cada um deles montava o caminho à mão, escolhia o bucket pelo nome
 * de uma variável só, e **gravava a URL pública numa coluna do banco**.
 *
 * As três mudanças que importam:
 *
 * 1. **O destino vem da classe do dado**, não do chamador. Ver
 *    `classificacao.ts` para o porquê — resumidamente, o R2 não garante
 *    residência física no Brasil, e os dois buckets criados nasceram em `ENAM`.
 * 2. **O banco guarda referência, não URL.** URL amarra o banco ao provedor, e
 *    URL assinada guardada expira e deixa a coluna apontando para um 403.
 * 3. **A chave sempre começa pelo workspace**, e é a única forma de montar
 *    chave — para que uma rota nova não possa esquecer a fronteira de inquilino.
 */

export { CLASSES, ClasseBloqueadaError, ObjetoAusenteError, chaveDe, podeGravar, provedorDa }
export type { Classe, NomeDeProvedor, OpcoesDeGravacao, Referencia }

/**
 * Os provedores, construídos sob demanda e guardados por isolate.
 *
 * Preguiçoso de propósito: a aplicação roda hoje com o provedor brasileiro
 * **não configurado**, e construir tudo na carga do módulo faria toda rota que
 * importa este arquivo falhar por causa de uma configuração que ela não usa.
 */
const instancias = new Map<NomeDeProvedor, ProvedorDeObjetos>()

class ProvedorNaoConfiguradoError extends Error {
    constructor(nome: NomeDeProvedor, faltando: string[]) {
        super(
            `o provedor de storage "${nome}" não está configurado; faltam: ${faltando.join(', ')}`
        )
        this.name = 'ProvedorNaoConfiguradoError'
    }
}

function lerConfig(prefixo: string, nome: NomeDeProvedor) {
    const endpoint = process.env[`${prefixo}_ENDPOINT`]?.trim()
    const accessKeyId = process.env[`${prefixo}_ACCESS_KEY_ID`]?.trim()
    const secretAccessKey = process.env[`${prefixo}_SECRET_ACCESS_KEY`]?.trim()
    const bucket = process.env[`${prefixo}_BUCKET`]?.trim()

    const faltando = [
        !endpoint && `${prefixo}_ENDPOINT`,
        !accessKeyId && `${prefixo}_ACCESS_KEY_ID`,
        !secretAccessKey && `${prefixo}_SECRET_ACCESS_KEY`,
        !bucket && `${prefixo}_BUCKET`,
    ].filter((x): x is string => typeof x === 'string')

    if (faltando.length > 0) throw new ProvedorNaoConfiguradoError(nome, faltando)

    return {
        endpoint: endpoint!,
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
        bucket: bucket!,
        region: process.env[`${prefixo}_REGION`]?.trim(),
    }
}

/** O prefixo de ambiente de cada provedor. Nomes fixados em `docs/migration`. */
const PREFIXO: Record<NomeDeProvedor, string> = {
    r2: 'PUBLIC_STORAGE',
    brasil: 'SENSITIVE_STORAGE',
}

function provedor(nome: NomeDeProvedor): { cliente: ProvedorDeObjetos; bucket: string } {
    const config = lerConfig(PREFIXO[nome], nome)

    let cliente = instancias.get(nome)
    if (!cliente) {
        cliente = new ProvedorS3({
            nome,
            endpoint: config.endpoint,
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            region: config.region,
        })
        instancias.set(nome, cliente)
    }

    return { cliente, bucket: config.bucket }
}

/**
 * Grava um objeto e devolve a referência para o banco.
 *
 * Lança `ClasseBloqueadaError` quando a classe não tem destino aprovado — e é
 * aqui que a decisão pendente do provedor brasileiro aparece como erro em vez de
 * virar arquivo clínico no R2.
 */
export async function gravar(
    classe: Classe,
    chave: string,
    corpo: Uint8Array<ArrayBuffer>,
    opcoes: OpcoesDeGravacao
): Promise<Referencia> {
    const nome = provedorDa(classe)
    const { cliente, bucket } = provedor(nome)

    await cliente.gravar(bucket, chave, corpo, opcoes)

    return {
        provedor: nome,
        bucket,
        chave,
        classe,
        contentType: opcoes.contentType,
        tamanho: corpo.byteLength,
    }
}

/** Lê os bytes. `null` quando não existe. */
export async function ler(ref: Referencia): Promise<Uint8Array<ArrayBuffer> | null> {
    const { cliente } = provedor(ref.provedor)
    return cliente.ler(ref.bucket, ref.chave)
}

export async function apagar(ref: Referencia): Promise<void> {
    const { cliente } = provedor(ref.provedor)
    await cliente.apagar(ref.bucket, ref.chave)
}

export async function existe(ref: Referencia): Promise<boolean> {
    const { cliente } = provedor(ref.provedor)
    return cliente.existe(ref.bucket, ref.chave)
}

/**
 * Validade máxima de uma URL assinada.
 *
 * Dez minutos: é tempo de um navegador carregar a imagem e não é tempo de a URL
 * circular por um grupo de WhatsApp. Conteúdo clínico não deve ter endereço
 * compartilhável, e URL assinada longa é exatamente isso.
 */
export const VALIDADE_MAXIMA_SEGUNDOS = 600

/**
 * O endereço para servir um objeto ao navegador.
 *
 * Público sai por URL direta e cacheável — é imagem de agente, e passar isso
 * pelo Worker gastaria invocação para servir byte que a borda serve melhor.
 *
 * Sensível sai por **URL assinada de validade curta**, e nunca é persistida.
 */
export async function enderecoPara(
    ref: Referencia,
    validadeSegundos = VALIDADE_MAXIMA_SEGUNDOS
): Promise<string> {
    if (ref.classe === CLASSES.PUBLICO) {
        const base = process.env.PUBLIC_STORAGE_BASE_URL?.trim()
        if (base) {
            const caminho = ref.chave.split('/').map(encodeURIComponent).join('/')
            return `${base.replace(/\/+$/, '')}/${caminho}`
        }
        // Sem domínio público configurado, cai para assinada — degrada em vez de
        // devolver uma URL que responde 403.
    }

    const { cliente } = provedor(ref.provedor)
    return cliente.urlAssinada(
        ref.bucket,
        ref.chave,
        Math.min(validadeSegundos, VALIDADE_MAXIMA_SEGUNDOS)
    )
}
