import { bindings, defineConfig, defineWorker, exports, triggers } from 'cf/config'

import * as entrypoint from './src/cloudflare/entrada.ts' with { type: 'cf-worker' }
import { cronsParaWrangler } from './src/lib/cron/agenda'
import { ALL_QUEUES } from './src/lib/queue/definitions'

/**
 * A configuração do Worker do OdontoBox360.
 *
 * **NÃO ESTÁ PRONTA PARA PUBLICAR**, e o que falta está marcado com PENDENTE.
 * Nada aqui foi provisionado na conta, exceto os buckets R2, que existem.
 *
 * E não pode ser validada nesta máquina: `cf dev`, `vite build` e qualquer coisa
 * que instancie Miniflare falham **ao carregar a configuração**, antes de
 * compilar — o `workerd` exige macOS 13.5+ e o Mac de desenvolvimento está em
 * 12.7.6. O que dá para verificar aqui é o **typecheck**, que não é pouco: os
 * tipos de `cf/config` recusam binding malformado, nome de fila inexistente e
 * export de Durable Object que a entrada não declara.
 *
 * Ver `docs/migration/00-open-decisions.md` §1.
 */

const NOME = 'venn-odontobox360'

/** O nome da fila na conta, a partir do nome lógico. */
const naConta = (fila: string) => `odontobox-${fila}`

/**
 * As políticas de consumo, derivadas de `DEFAULT_JOB_OPTIONS` do BullMQ.
 *
 * `maxRetries` é `attempts - 1`: no BullMQ o número conta a tentativa inicial,
 * aqui conta só as repetições. Copiar faria cada fila tentar uma vez mais.
 *
 * `retryDelay` é **fixo** no Queues — não há backoff exponencial de
 * configuração. Onde o crescimento importa, o consumidor pede a retentativa com
 * o atraso que quiser; ver `BACKOFF` em `src/cloudflare/entrada.ts`.
 */
const CONSUMO = {
    'whatsapp-inbound': {
        maxRetries: 4,
        retryDelay: 2,
        // Lote pequeno: cada mensagem grava contato, conversa e mídia. Lote
        // grande arriscaria o teto de CPU por um ganho inexistente — o volume é
        // de mensagens de clínica, não de telemetria.
        maxBatchSize: 5,
        maxBatchTimeout: 2,
    },
    'whatsapp-event': {
        maxRetries: 2,
        retryDelay: 1,
        // Recibo de entrega e presença: baratos, e vale agrupar.
        maxBatchSize: 25,
        maxBatchTimeout: 5,
    },
    'whatsapp-outbound': {
        maxRetries: 4,
        retryDelay: 3,
        // Uma por vez: enviar é chamada ao provedor, e um lote que falha no meio
        // deixa parte enviada — com a retentativa reenviando o que já saiu.
        // Mensagem repetida para o paciente é pior que lentidão.
        maxBatchSize: 1,
    },
    'ai-reply': {
        maxRetries: 2,
        retryDelay: 5,
        // Uma por vez: cada uma é uma chamada de LLM.
        maxBatchSize: 1,
    },
    'rag-index': {
        maxRetries: 2,
        retryDelay: 5,
        maxBatchSize: 1,
        // Indexar é CPU e chamada de embedding; deixar escalar livre disputaria
        // banco com o atendimento, que é o que importa.
        maxConcurrency: 2,
    },
    'agent-webhook': { maxRetries: 3, retryDelay: 10, maxBatchSize: 5 },
    'asaas-event': {
        // Sete repetições: o evento já está gravado em `asaas_events`, então
        // reprocessar é barato e idempotente — e o que está em jogo é ativar
        // plano e creditar compra.
        maxRetries: 7,
        retryDelay: 5,
        maxBatchSize: 5,
    },
    cron: {
        maxRetries: 1,
        retryDelay: 30,
        maxBatchSize: 1,
        // Uma rotina por vez: duas varreduras de retenção em paralelo
        // disputariam as mesmas linhas.
        maxConcurrency: 1,
    },
} as const

export default defineConfig({
    worker: defineWorker({
        name: NOME,
        entrypoint,
        compatibilityDate: '2026-10-21',
        // Necessário pelo driver do banco e pelos poucos usos de `node:crypto`
        // e `node:path` que o inventário encontrou.
        compatibilityFlags: ['nodejs_compat'],

        assets: {
            htmlHandling: 'none',
            notFoundHandling: 'none',
            runWorkerFirst: ['/*', '!/_next/static/*', '!/*/_next/static/*'],
        },

        /**
         * As classes de Durable Object que **esta** entrada declara.
         *
         * `sqlite` e não `legacy-kv`: é o recomendado para classes novas, e
         * nenhuma das duas guarda volume — a sala mantém o histórico em memória
         * de propósito, e a agenda guarda três chaves.
         */
        exports: {
            SalaDoWorkspace: exports.durableObject({ storage: 'sqlite' }),
            AgendaDaConversa: exports.durableObject({ storage: 'sqlite' }),
        },

        env: {
            ASSETS: bindings.assets(),

            /**
             * Os Durable Objects, referenciados pelo próprio nome do Worker.
             *
             * As duas são fronteira de isolamento por **topologia**, não por
             * filtro: `SalaDoWorkspace` é por workspace, e ninguém recebe evento
             * de outra clínica porque não está no mesmo objeto. Filtro se
             * esquece de aplicar; topologia não. Depois da remoção do RLS
             * (`01-compatibility.md` §13) isso pesa mais do que pesaria antes.
             */
            SALA_DO_WORKSPACE: bindings.durableObject({
                worker: NOME,
                exportName: 'SalaDoWorkspace',
            }),
            AGENDA_DA_CONVERSA: bindings.durableObject({
                worker: NOME,
                exportName: 'AgendaDaConversa',
            }),

            /**
             * As oito filas, como produtor.
             *
             * Oito e não uma com discriminador: as políticas de retentativa
             * divergem de propósito (ver `CONSUMO`), e uma indexação de RAG de
             * documento grande atrás de uma mensagem de WhatsApp atrasaria o
             * atendimento.
             */
            WHATSAPP_INBOUND: bindings.queue({ name: naConta('whatsapp-inbound') }),
            WHATSAPP_EVENT: bindings.queue({ name: naConta('whatsapp-event') }),
            WHATSAPP_OUTBOUND: bindings.queue({ name: naConta('whatsapp-outbound') }),
            AI_REPLY: bindings.queue({ name: naConta('ai-reply') }),
            RAG_INDEX: bindings.queue({ name: naConta('rag-index') }),
            AGENT_WEBHOOK: bindings.queue({ name: naConta('agent-webhook') }),
            ASAAS_EVENT: bindings.queue({ name: naConta('asaas-event') }),
            CRON: bindings.queue({ name: naConta('cron') }),

            /**
             * R2 — **somente conteúdo público**.
             *
             * Os dois buckets existem e nasceram em `ENAM`, leste da América do
             * Norte: é a prova concreta de que nada clínico pode ir para cá. O
             * adaptador roteia pela classe do dado e recusa gravar classe
             * clínica enquanto o provedor brasileiro não for aprovado.
             *
             * O binding fica declarado mas o adaptador **não o usa**: ele fala
             * S3, para que a mesma implementação sirva ao R2 e à Magalu. Ver
             * `src/lib/storage/s3.ts`.
             */
            PUBLICO: bindings.r2({ name: 'venn-odontobox360-publico-prod' }),

            // Variáveis, só o que não é segredo.
            TZ: bindings.text('America/Sao_Paulo'),
            LOG_LEVEL: bindings.text('info'),

            /**
             * Os segredos, declarados sem valor.
             *
             * `bindings.secret()` diz que existe e que vem de fora — o valor
             * entra por `wrangler secret put` / `cf secret put` e **nunca** pelo
             * repositório. A lista completa está em `02-runbook.md` §A.5.
             */
            DATABASE_URL: bindings.secret(),
            BETTER_AUTH_SECRET: bindings.secret(),
            TOKEN_ENCRYPTION_KEY: bindings.secret(),
            OPENAI_API_KEY: bindings.secret(),
            RESEND_API_KEY: bindings.secret(),
            EVOLUTION_GO_API_KEY: bindings.secret(),
            EVOLUTION_API_KEY: bindings.secret(),
            GOOGLE_CLIENT_SECRET: bindings.secret(),
            PLATFORM_ASAAS_CLIENT_ID: bindings.secret(),
            PLATFORM_ASAAS_CLIENT_SECRET: bindings.secret(),
            PLATFORM_INSTAGRAM_LOGIN_CLIENT_SECRET: bindings.secret(),
            PLATFORM_META_MESSAGING_CLIENT_SECRET: bindings.secret(),
            PLATFORM_META_MESSAGING_VERIFY_TOKEN: bindings.secret(),
            PUBLIC_STORAGE_ACCESS_KEY_ID: bindings.secret(),
            PUBLIC_STORAGE_SECRET_ACCESS_KEY: bindings.secret(),
        },

        triggers: [
            /**
             * Os oito consumidores.
             *
             * A DLQ é criada sozinha no deploy se não existir, e mensagem numa
             * DLQ sem consumidor persiste quatro dias — tempo de alguém ver.
             */
            ...ALL_QUEUES.map((fila) =>
                triggers.queue({
                    name: naConta(fila),
                    deadLetterQueue: `${naConta(fila)}-dlq`,
                    ...CONSUMO[fila],
                })
            ),

            /**
             * Os treze crons, **em UTC**.
             *
             * A lista é gerada por `cronsParaWrangler()` a partir da intenção
             * declarada em horário de Brasília. Cron Triggers não aceitam fuso:
             * copiar os padrões do produto faria o boletim das 7 h disparar às
             * 4 h da manhã, a poda de retenção à 1 h41 e o corte de cobrança às
             * 2 h27 — tudo funcionando, tudo na hora errada, nada acusando erro.
             *
             * Gerada e não escrita à mão de propósito, e `npm run check:filas`
             * compara as duas — porque a divergência não daria erro: valeria o
             * que está aqui, e a tabela do código passaria a ser ficção.
             */
            ...cronsParaWrangler().map((schedule) => triggers.scheduled({ schedule })),
        ],
    }),
})

/**
 * PENDENTE, e cada um precisa de decisão ou provisionamento:
 *
 *   - **as oito filas e suas DLQ não existem na conta.** Criar com
 *     `wrangler queues create <nome>`;
 *   - `hyperdrive`: só depois de medir. O adaptador do Neon fala por
 *     HTTP/WebSocket e o banco está em São Paulo; o ganho do Hyperdrive é cache
 *     de conexão, e sem medição seria recurso pago por reflexo;
 *   - o **AI Gateway** é configurado por URL base, não por binding, mas o
 *     gateway precisa ser criado na conta;
 *   - **Containers** para o Evolution Go, sujeito à POC. Se ela falhar no item
 *     "sobrevive a período sem tráfego", ele não vem para cá;
 *   - **Cloudflare Email Service**, que fica para depois do primeiro corte — o
 *     Resend segue atendendo;
 *   - `SENSITIVE_STORAGE_*`, que depende da aprovação do provedor brasileiro.
 */
