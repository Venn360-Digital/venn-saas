import 'server-only'
import { AwsClient } from 'aws4fetch'
import type { NomeDeProvedor } from './classificacao'
import { ObjetoAusenteError, type OpcoesDeGravacao, type ProvedorDeObjetos } from './tipos'

/**
 * Um provedor de objetos sobre a API S3.
 *
 * **Uma implementação, dois destinos.** O R2 fala S3, e a Magalu Cloud também —
 * então o mesmo código serve ao bucket público e ao bucket clínico, e trocar de
 * provedor brasileiro depois não é reescrever, é mudar endpoint e credencial.
 * Era isso ou duas implementações que divergiriam na primeira correção feita só
 * em uma delas.
 *
 * **Por que `aws4fetch` e não o SDK da AWS.** 64 KB contra alguns megabytes, e
 * ele assina com WebCrypto e `fetch` — as duas coisas que existem tanto em
 * Workers quanto no Node 24. O SDK carrega polyfills de Node que encareceriam o
 * bundle do Worker sem trazer nada que estes cinco métodos usem.
 *
 * **Por que não o binding nativo do R2.** `env.BUCKET.put()` é mais rápido e
 * dispensa credencial, mas só existe dentro do Worker: não funciona no
 * `next dev`, não funciona no processo `workers/` que grava mídia hoje, e não
 * serviria à Magalu. Portabilidade é decisão registrada, e aqui ela custa uma
 * assinatura HMAC por pedido.
 */
export class ProvedorS3 implements ProvedorDeObjetos {
    readonly nome: NomeDeProvedor
    private readonly cliente: AwsClient
    private readonly endpoint: string

    constructor(config: {
        nome: NomeDeProvedor
        /** Sem barra final. Ex.: `https://<conta>.r2.cloudflarestorage.com` */
        endpoint: string
        accessKeyId: string
        secretAccessKey: string
        /** `auto` no R2; a região real na Magalu. */
        region?: string
    }) {
        this.nome = config.nome
        this.endpoint = config.endpoint.replace(/\/+$/, '')
        this.cliente = new AwsClient({
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            service: 's3',
            region: config.region ?? 'auto',
        })
    }

    private url(bucket: string, chave: string): string {
        /**
         * Cada segmento é codificado separadamente para que a barra siga sendo
         * separador de caminho — `encodeURIComponent` na chave inteira
         * transformaria `workspace/arquivo.png` em um nome de objeto com `%2F`
         * dentro, que é um objeto diferente.
         */
        const caminho = chave.split('/').map(encodeURIComponent).join('/')
        return `${this.endpoint}/${bucket}/${caminho}`
    }

    async gravar(
        bucket: string,
        chave: string,
        corpo: Uint8Array<ArrayBuffer>,
        opcoes: OpcoesDeGravacao
    ): Promise<void> {
        const cabecalhos: Record<string, string> = { 'Content-Type': opcoes.contentType }

        /**
         * Sem `substituir`, a gravação é condicional no servidor.
         *
         * `If-None-Match: *` faz o próprio provedor recusar quando a chave já
         * existe. A alternativa — consultar antes e gravar depois — tem janela de
         * corrida entre as duas chamadas, e a mídia recebida do WhatsApp chega em
         * paralelo.
         */
        if (!opcoes.substituir) cabecalhos['If-None-Match'] = '*'

        const resposta = await this.cliente.fetch(this.url(bucket, chave), {
            method: 'PUT',
            body: corpo,
            headers: cabecalhos,
        })

        if (!resposta.ok) {
            throw new Error(
                `falha ao gravar ${bucket}/${chave}: HTTP ${resposta.status} ${await this.corpoDoErro(resposta)}`
            )
        }
    }

    async ler(bucket: string, chave: string): Promise<Uint8Array<ArrayBuffer> | null> {
        const resposta = await this.cliente.fetch(this.url(bucket, chave))

        // Ausente é `null`, não exceção: "não existe" é resposta normal para
        // quem serve mídia, e quem precisa de erro usa `ObjetoAusenteError`.
        if (resposta.status === 404) return null
        if (!resposta.ok) {
            throw new Error(
                `falha ao ler ${bucket}/${chave}: HTTP ${resposta.status} ${await this.corpoDoErro(resposta)}`
            )
        }

        return new Uint8Array(await resposta.arrayBuffer())
    }

    async apagar(bucket: string, chave: string): Promise<void> {
        const resposta = await this.cliente.fetch(this.url(bucket, chave), { method: 'DELETE' })

        // S3 devolve 204 para objeto que não existia. Apagar é idempotente, e
        // tratar isso como erro faria retentativa de fila falhar na segunda volta.
        if (!resposta.ok && resposta.status !== 404) {
            throw new Error(
                `falha ao apagar ${bucket}/${chave}: HTTP ${resposta.status} ${await this.corpoDoErro(resposta)}`
            )
        }
    }

    async existe(bucket: string, chave: string): Promise<boolean> {
        const resposta = await this.cliente.fetch(this.url(bucket, chave), { method: 'HEAD' })
        if (resposta.status === 404) return false
        if (!resposta.ok) {
            throw new Error(`falha ao consultar ${bucket}/${chave}: HTTP ${resposta.status}`)
        }
        return true
    }

    /**
     * URL assinada de validade curta, por query string.
     *
     * `aws4fetch` assina na query quando recebe `X-Amz-Expires`, e o resultado é
     * uma URL que o navegador busca sozinho — sem passar os bytes pelo Worker.
     *
     * **Nunca persistir o retorno.** Ela expira, e guardada numa coluna deixa o
     * banco apontando para um 403. É por isso que `Referencia` guarda chave e
     * não URL.
     */
    async urlAssinada(bucket: string, chave: string, validadeSegundos: number): Promise<string> {
        const url = new URL(this.url(bucket, chave))
        url.searchParams.set('X-Amz-Expires', String(validadeSegundos))

        const assinado = await this.cliente.sign(url.toString(), {
            method: 'GET',
            aws: { signQuery: true },
        })

        return assinado.url
    }

    /** O corpo do erro, truncado — o S3 responde XML, e inteiro ele polui o log. */
    private async corpoDoErro(resposta: Response): Promise<string> {
        try {
            return (await resposta.text()).slice(0, 200)
        } catch {
            return ''
        }
    }
}

export { ObjetoAusenteError }
