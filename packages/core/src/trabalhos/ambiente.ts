import { z } from 'zod'
import {
    CANDIDATOS_PADRAO,
    MAX_POR_DOCUMENTO,
    PISO_PADRAO,
    TRECHOS_PADRAO,
} from '../lib/rag/parametros'

/**
 * O ambiente que o trabalho de fila precisa — e só ele.
 *
 * Substitui `workers/src/env.ts`, e com duas diferenças que não são de estilo.
 *
 * **Primeira: é preguiçoso.** O original validava no carregamento do módulo e
 * chamava `process.exit(1)` ao falhar. Num Worker isso é pior do que parece:
 * `process.exit` não derruba o isolate, a execução continua, e
 * `export const env = parsed.data` publica `undefined` — então todo acesso
 * `env.X` vira `TypeError` num lugar distante da causa. E como o módulo é
 * carregado junto com o Worker inteiro, um segredo faltando levaria **o site**
 * com ele, não só a fila. Aqui a validação acontece no primeiro acesso e
 * **lança**: a mensagem da fila volta para retentativa, e o `fetch` segue
 * atendendo.
 *
 * **Segunda: tem nove chaves, não vinte e seis.** As outras dezessete eram do
 * processo que a Cloudflare substitui — `REDIS_URL`, `WORKER_CONCURRENCY`,
 * `WORKER_HEALTH_PORT`, `WORKER_QUEUES`, `ENABLE_SCHEDULER` — ou da plataforma anterior,
 * que saiu. Carregá-las adiante faria o Worker exigir, para subir, coisas que
 * não existem mais. Estas nove foram medidas: são as que o código portado lê.
 *
 * `process.env` funciona aqui porque `nodejs_compat` está ligado e a data de
 * compatibilidade é posterior a 2025-04-01 — a plataforma popula `process.env`
 * a partir dos *bindings* de texto e dos segredos, na primeira vez que
 * `process` é acessado.
 */
const esquema = z.object({
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    /** Opcional individualmente; a fábrica valida o provedor em uso. */
    OPENAI_API_KEY: z.string().optional(),

    /**
     * Teto do texto que o agente fala, em caracteres.
     *
     * Acima dele a resposta vai como texto. Nota de voz de dois minutos ninguém
     * ouve até o fim, e a fala é cobrada pelo tamanho do texto.
     */
    AGENT_SPEECH_MAX_CHARS: z.coerce.number().int().positive().default(900),

    /** Quantas mensagens passadas alimentam o modelo como contexto. */
    AI_HISTORY_LIMIT: z.coerce.number().int().positive().default(20),

    /**
     * Trechos de conhecimento injetados no prompt. Zero desliga o RAG.
     *
     * O padrão vem de `lib/rag/parametros`, que é também quem o medidor e o
     * console de ensaio leem — o número que governa a busca não pode ter uma
     * cópia por leitor.
     */
    AI_RAG_CHUNKS: z.coerce.number().int().min(0).max(50).default(TRECHOS_PADRAO),

    /**
     * Piso de similaridade para um trecho entrar na resposta.
     *
     * Declarado aqui para o Worker **validar** o que recebe: antes era lido cru
     * de `process.env` dentro do retriever, então um valor inválido caía no
     * padrão sem avisar ninguém. O padrão e as outras leituras vivem em
     * `lib/rag/parametros`.
     */
    AI_RAG_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(PISO_PADRAO),

    /** Candidatos por perna da busca híbrida, antes da fusão por RRF. */
    AI_RAG_CANDIDATOS: z.coerce.number().int().min(1).max(200).default(CANDIDATOS_PADRAO),

    /** Teto de trechos do mesmo documento numa resposta. Zero desliga o teto. */
    AI_RAG_MAX_POR_DOC: z.coerce.number().int().min(0).max(50).default(MAX_POR_DOCUMENTO),

    /**
     * Segundos de espera por mais mensagens do mesmo contato antes de responder.
     *
     * O teto da rajada vive em `lib/realtime/debounce.ts`, não aqui: sem ele,
     * mensagens a cada 3 s com espera de 4 s empurram a resposta para sempre.
     */
    INBOUND_DEBOUNCE_SECONDS: z.coerce.number().int().min(0).default(4),

    /** Até onde a recorrência materializa atividades repetidas. */
    RECURRENCE_HORIZON_DAYS: z.coerce.number().int().positive().default(60),

    /** A retenção só apaga quando isto é a string literal "true". PRODUCT.md §7. */
    RETENTION_DELETION_ENABLED: z.string().optional(),

    /**
     * Reciclar o soquete 20 s depois de parear.
     *
     * Desligado por padrão: medido não funcionar no Evolution Go implantado — o
     * `/instance/disconnect` responde 200 e registra "Ignoring disconnect as it
     * was not connected" durante a janela de reconexão. O contorno que funciona
     * é reiniciar o contêiner, e em Containers isso virou
     * `poc/canal-whatsapp/`.
     */
    EVOLUTION_GO_RECYCLE_AFTER_PAIR: z.enum(['true', 'false']).default('false'),
})

export type Ambiente = z.infer<typeof esquema>

export class AmbienteInvalidoError extends Error {
    constructor(problemas: string) {
        super(`ambiente do trabalho inválido:\n${problemas}`)
        this.name = 'AmbienteInvalidoError'
    }
}

let cache: Ambiente | null = null

/** Valida na primeira chamada e guarda. Lança `AmbienteInvalidoError`. */
export function ambiente(): Ambiente {
    if (cache) return cache

    const lido = esquema.safeParse(process.env)
    if (!lido.success) {
        throw new AmbienteInvalidoError(
            lido.error.issues.map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`).join('\n')
        )
    }

    cache = lido.data
    return cache
}

/**
 * A mesma forma de acesso do módulo antigo (`env.OPENAI_API_KEY`), para que o
 * código portado não precise mudar em cada ponto de leitura — mas por trás é a
 * validação preguiçosa acima.
 */
export const env: Ambiente = new Proxy({} as Ambiente, {
    get(_alvo, prop, receptor) {
        return Reflect.get(ambiente(), prop, receptor)
    },
    has(_alvo, prop) {
        return Reflect.has(ambiente(), prop)
    },
    ownKeys() {
        return Reflect.ownKeys(ambiente())
    },
    getOwnPropertyDescriptor(_alvo, prop) {
        return Reflect.getOwnPropertyDescriptor(ambiente(), prop)
    },
})

/** Só para os testes: esquece o que foi validado. */
export function esquecerAmbiente(): void {
    cache = null
}
