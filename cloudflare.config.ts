import { bindings, defineConfig, defineWorker, exports, triggers } from 'cf/config'

import * as entrypoint from './src/cloudflare/entrada.ts' with { type: 'cf-worker' }
import { cronsParaWrangler } from './src/lib/cron/agenda.ts'
import { ALL_QUEUES, TENTATIVAS } from './src/lib/queue/definitions.ts'

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

/**
 * O nome do Worker, e ele é a IDENTIDADE do recurso na Cloudflare.
 *
 * Decisão do André em 2026-10-21: `odontobox`. Era `venn-odontobox360`, herdado
 * do nome do pacote.
 *
 * **Tem de estar certo antes do primeiro deploy.** Não existe renomear Worker
 * no Cloudflare: publicar com nome novo cria OUTRO Worker, e o antigo fica com
 * os Durable Objects, as filas vinculadas e a rota. Trocar depois significa
 * migrar estado de DO, não editar um campo.
 */
const NOME = 'odontobox'

/** O nome da fila na conta, a partir do nome lógico. */
const naConta = (fila: string) => `odontobox-${fila}`

/**
 * As políticas de consumo, derivadas de `DEFAULT_JOB_OPTIONS` do BullMQ.
 *
 * `maxRetries` é `attempts - 1`: no BullMQ o número conta a tentativa inicial,
 * aqui conta só as repetições, e vem de `TENTATIVAS[fila] - 1` — não é escrito
 * neste arquivo.
 *
 * `retryDelay` é **fixo** no Queues — não há backoff exponencial de
 * configuração. Onde o crescimento importa, o consumidor pede a retentativa com
 * o atraso que quiser; ver `BACKOFF` em `src/cloudflare/entrada.ts`.
 */
const CONSUMO = {
    'whatsapp-inbound': {
        retryDelay: 2,
        /**
         * Uma mensagem por invocação, **entregue na hora**.
         *
         * Era lote de 5 com espera de 2 s. Medido em 2026-10-23: uma mensagem
         * sozinha — o caso normal numa clínica — esperava **3,7 s** na fila
         * antes de o consumidor começar, e esse era o maior pedaço do atraso
         * entre o paciente enviar e a mensagem aparecer na tela. O lote só se
         * enche quando chegam várias mensagens ao mesmo tempo, que é
         * exatamente quando a espera menos importa.
         *
         * Lote cheio dispara sem esperar o tempo-limite ("whichever happens
         * first", na documentação), então com tamanho 1 cada mensagem sai no
         * ato. O tempo-limite fica em 1 s só por ser explícito: com lote de 1
         * ele nunca é alcançado.
         */
        maxBatchSize: 1,
        maxBatchTimeout: 1,
    },
    'whatsapp-event': {
        retryDelay: 1,
        // Recibo de entrega e presença: baratos, e vale agrupar.
        maxBatchSize: 25,
        maxBatchTimeout: 5,
    },
    'whatsapp-outbound': {
        retryDelay: 3,
        // Uma por vez: enviar é chamada ao provedor, e um lote que falha no meio
        // deixa parte enviada — com a retentativa reenviando o que já saiu.
        // Mensagem repetida para o paciente é pior que lentidão.
        maxBatchSize: 1,
    },
    'ai-reply': {
        retryDelay: 5,
        // Uma por vez: cada uma é uma chamada de LLM.
        maxBatchSize: 1,
    },
    'rag-index': {
        retryDelay: 5,
        maxBatchSize: 1,
        // Indexar é CPU e chamada de embedding; deixar escalar livre disputaria
        // banco com o atendimento, que é o que importa.
        maxConcurrency: 2,
    },
    'agent-webhook': {  retryDelay: 10, maxBatchSize: 5 },
    broadcast: {
        // Uma por vez: cada `send` é uma chamada ao provedor, e o ritmo do
        // disparo é controlado pelo atraso escalonado no fan-out, não pelo lote.
        retryDelay: 3,
        maxBatchSize: 1,
        // Não disputar o atendimento: o disparo em massa cede o passo.
        maxConcurrency: 2,
    },
    'asaas-event': {
        // Sete repetições: o evento já está gravado em `asaas_events`, então
        // reprocessar é barato e idempotente — e o que está em jogo é ativar
        // plano e creditar compra.
        retryDelay: 5,
        maxBatchSize: 5,
    },
    cron: {
        retryDelay: 30,
        maxBatchSize: 1,
        // Uma rotina por vez: duas varreduras de retenção em paralelo
        // disputariam as mesmas linhas.
        maxConcurrency: 1,
    },
} as const

/**
 * Preview não aceita `triggers`, e isso é bom.
 *
 * Medido em 2026-10-21: `cf previews deploy` recusa com
 * "Preview uploads from Build Output don't support the `triggers` field."
 *
 * Omitir no preview não é contorno, é o comportamento correto. Um Worker de
 * preview com estes gatilhos **disputaria mensagem de fila real** com a
 * produção (consumidor a mais na mesma fila, e cada mensagem é entregue a um
 * só) e **dispararia os doze crons** contra o banco real — boletim, poda de
 * retenção e corte de cobrança saindo de um PR. O preview serve para olhar
 * tela, não para processar trabalho.
 *
 * `CF_PREVIEW` é declarado em `preview.yml`. Na ausência dele vale produção,
 * de propósito: esquecer a variável não pode silenciar os gatilhos de quem
 * atende cliente.
 */
const EH_PREVIEW = process.env.CF_PREVIEW === '1'

const GATILHOS = [

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
                // Derivado, nunca escrito à mão: `maxRetries` conta só as
                // repetições, e o consumidor precisa do total para saber se
                // está na última tentativa. Dois números escritos à parte se
                // separariam calados — ver `TENTATIVAS` em `definitions.ts`.
                maxRetries: TENTATIVAS[fila] - 1,
                ...CONSUMO[fila],
            })
        ),

        /**
         * Os doze crons, **em UTC**.
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
]

export default defineConfig({
    worker: defineWorker({
        name: NOME,
        entrypoint,
        compatibilityDate: '2026-10-21',
        // Necessário pelo driver do banco e pelos poucos usos de `node:crypto`
        // e `node:path` que o inventário encontrou.
        compatibilityFlags: ['nodejs_compat'],

        /**
         * **A porta lateral fechada.** `odontobox.andre-7ee.workers.dev` servia
         * o app inteiro — e não é da zona `venn360.com`.
         *
         * Isso é o que torna o subdomínio um problema de segurança e não só de
         * estética: regra de WAF, rate limiting, Bot Management e Access vivem
         * **na zona**. Nada do que se configure em `venn360.com` alcança um
         * hostname `workers.dev`. Fechar a porta da frente e deixar a lateral
         * aberta é configurar a borda para ninguém.
         *
         * Medido em 2026-10-24: até as 02:11 UTC **todo** webhook de entrada do
         * WhatsApp chegava por `odontobox.andre-7ee.workers.dev`, porque era o
         * valor gravado em `WEBHOOK_BASE_URL`. Ou seja, a mensagem de paciente
         * entrava pela porta sem borda. Às 02:18, depois de trocar o segredo e
         * reconectar a linha, o inbound passou a chegar em
         * `odontobox.venn360.com` — foi essa prova que liberou desligar isto.
         *
         * **A ordem não pode inverter.** Desligar antes de o Evolution ter o
         * webhook novo gravado corta o inbound de WhatsApp na hora, porque o
         * valor mora no banco de cada instância e só é reescrito num
         * `/instance/connect`.
         *
         * `previewUrls` fica **ligado**: as URLs de versão que o `preview.yml`
         * publica são outro mecanismo, e desligá-las cegaria a revisão de PR.
         * Elas também são `workers.dev`, mas efêmeras, por versão, e não
         * servem a produção.
         */
        workersDev: false,
        previewUrls: true,

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
            TravaDeContato: exports.durableObject({ storage: 'sqlite' }),
        },

        env: {
            ASSETS: bindings.assets(),

            /**
             * E-mail transacional, pelo Email Sending. O remetente fica no
             * subdomínio dedicado (`mail.venn360.com`), que é quem carrega a
             * reputação de envio — o MX do apex continua com a caixa de entrada.
             *
             * **Sem `destinationAddress`**, e é a decisão que importa aqui:
             * travar o destino no binding serve a formulário de contato, onde o
             * destinatário é sempre a mesma caixa. Estes e-mails vão para o dono
             * da clínica, para quem foi convidado, para quem pediu a senha de
             * volta — destinatário diferente a cada envio. Com a trava, todo
             * envio que não fosse para o próprio endereço do sistema seria
             * recusado pela plataforma, e o aviso de cobrança nunca chegaria.
             *
             * Ver `docs/email-service-migration.md` para o que precisa estar
             * configurado no painel.
             */
            EMAIL: bindings.sendEmail(),
            EMAIL_FROM: bindings.text('OdontoBox360 <noreply@mail.venn360.com>'),

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
            /**
             * A trava do passo "contato → negócio → conversa".
             *
             * Um objeto por contato, via `idFromName(chave)`. Substitui o
             * `SET NX PX` no Redis, e a substituição é mais forte que o
             * original: o Redis precisava de comando atômico porque atende em
             * paralelo, e um Durable Object atende **um pedido por vez** por
             * chave. Objeto sem trava ativa não guarda nada.
             */
            TRAVA_DE_CONTATO: bindings.durableObject({
                worker: NOME,
                exportName: 'TravaDeContato',
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
            BROADCAST: bindings.queue({ name: naConta('broadcast') }),
            CRON: bindings.queue({ name: naConta('cron') }),

            /**
             * R2 — público **e**, desde 2026-10-21, clínico.
             *
             * Este comentário dizia "somente conteúdo público" e que o clínico
             * era recusado até um provedor brasileiro ser aprovado. **Mudou por
             * decisão do André:** o clínico vai para `odontobox-private`, aqui
             * no R2 mesmo.
             *
             * Os buckets nasceram em `ENAM`, leste da América do Norte — o R2
             * não tem região na América do Sul e não existe jurisdição `br`.
             * Então o arquivo clínico **não fica no Brasil**, e o controle que
             * sustenta a escolha é cifra na aplicação, não localização. Ver
             * `src/lib/storage/classificacao.ts`.
             *
             * O binding fica declarado mas o adaptador **não o usa**: ele fala
             * S3, para que a mesma implementação sirva ao R2 e à Magalu. Ver
             * `src/lib/storage/s3.ts`.
             */
            /**
             * `odontobox-public`, e o nome é o que o André pediu em 2026-10-21.
             *
             * Era `venn-odontobox360-publico-prod`, da convenção
             * `venn-<produto>-<classe>-<ambiente>`. A troca saiu de graça porque
             * os dois buckets estavam com 0 objetos — conferido antes de mexer.
             * O bucket antigo ficou órfão e pode ser apagado.
             */
            /**
             * O canal QR do WhatsApp — agora no VPS, alcançado por HTTP via
             * Cloudflare Tunnel, não mais por service binding.
             *
             * Era `EVOLUTION_GO: bindings.worker({ worker: 'poc-canal-whatsapp' })`
             * — o contêiner do Evolution Go vivia em Cloudflare Containers e o
             * binding interno era a fronteira de autorização. Decisão de
             * 2026-10-23: processo com socket persistente 24/7 não combina com
             * compute que dorme, então o Evolution saiu para o VPS. O app volta
             * ao caminho HTTP do provider (`EVOLUTION_GO_URL`), e a API admin
             * fica atrás do Tunnel (sem porta aberta no VPS).
             *
             * `EVOLUTION_GO_URL` é o hostname do Tunnel; segredo porque é a
             * topologia da rede. `EVOLUTION_WEBHOOK_SECRET` é o que o Evolution
             * no VPS carrega no caminho do webhook para a app autenticar a
             * entrada (ver `src/app/api/webhooks/evolution-go/[secret]`).
             */
            EVOLUTION_GO_URL: bindings.secret(),
            EVOLUTION_WEBHOOK_SECRET: bindings.secret(),

            /**
             * O service token do Cloudflare Access, para alcançar o Tunnel.
             *
             * O Tunnel já tirava a porta do VPS, mas o hostname publicado
             * respondia a **qualquer um na internet** — a API e o manager
             * inteiros do Evolution Go, atrás de uma `apikey` só. Medido na
             * auditoria de 2026-10-23. A aplicação do Access em
             * `evo-odontobox.venn360.com` tem política de **Service Auth**, e
             * estes dois são a credencial que este Worker apresenta.
             *
             * **Declarados aqui porque esta configuração é declarativa.** O
             * `cf deploy` reconcilia o conjunto de bindings do script: segredo
             * gravado por `wrangler secret put` e **não** declarado aqui é
             * removido no deploy seguinte. Foi o que custou o corte de
             * `WEBHOOK_BASE_URL` em 2026-10-23.
             *
             * A consequência da declaração é a ordem: os dois têm de **existir
             * na conta antes** deste arquivo chegar a um deploy. Ver o cabeçalho
             * de `cabecalhosDoAccess()` em `lib/whatsapp/evolution-go.ts`, que
             * descreve os quatro passos e por que inverter dois deles derruba a
             * linha de WhatsApp.
             */
            CF_ACCESS_CLIENT_ID: bindings.secret(),
            CF_ACCESS_CLIENT_SECRET: bindings.secret(),

            /**
             * A base pública da app, para MONTAR a URL do webhook.
             *
             * **Por que isto precisa existir, e custou um corte.** Em
             * 2026-10-23 a linha não conectava: `/instance/create` devolvia
             * 200 e nenhum `/instance/connect` chegava ao Evolution. A causa
             * era `webhookUrlFor` (`src/lib/whatsapp/index.ts`), que lê
             * `WEBHOOK_BASE_URL ?? NEXT_PUBLIC_APP_URL` e lança quando as duas
             * faltam — e nenhuma das duas era declarada aqui. O erro acontecia
             * exatamente entre criar e conectar, e o sintoma na tela era só
             * "erro ao conectar".
             *
             * **E tem de ser esta, não `NEXT_PUBLIC_APP_URL`.** O Better Auth
             * usa `NEXT_PUBLIC_APP_URL` como `baseURL`
             * (`src/lib/auth/better-auth.ts`); defini-la para consertar o
             * webhook derruba a sessão de quem está logado. `webhookUrlFor`
             * prefere `WEBHOOK_BASE_URL`, então esta sozinha resolve e não
             * encosta na autenticação.
             *
             * Segredo pelo mesmo motivo de `EVOLUTION_GO_URL`: é topologia, e
             * o valor muda quando o domínio virar — e o valor gravado em cada
             * linha do Evolution é o que o rearme reaplica, então trocá-lo
             * exige reconectar as linhas (ver `infra/scripts/wa-webhook-guard.sh`).
             */
            WEBHOOK_BASE_URL: bindings.secret(),

            PUBLICO: bindings.r2({ name: 'odontobox-public' }),

            // Variáveis, só o que não é segredo.
            TZ: bindings.text('America/Sao_Paulo'),
            LOG_LEVEL: bindings.text('info'),

            /**
             * Os buckets do adaptador de storage, por NOME.
             *
             * Faltavam, e a falta não aparecia no deploy. `lerConfig` em
             * `src/lib/storage/index.ts` exige QUATRO variáveis por provedor —
             * `_ENDPOINT`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_BUCKET` —
             * e só as duas chaves estavam declaradas. Com as outras duas
             * ausentes o adaptador lança `ProvedorNaoConfiguradoError` no
             * primeiro upload, em produção, não na publicação.
             *
             * Nome de bucket não é segredo (já está neste arquivo, no binding
             * `PUBLICO` acima), então entra como texto. O endpoint vai como
             * segredo logo abaixo, porque carrega o ID da conta — que o André
             * guarda como segredo no GitHub, e eu respeito a mesma classificação.
             */
            PUBLIC_STORAGE_BUCKET: bindings.text('odontobox-public'),
            PRIVATE_STORAGE_BUCKET: bindings.text('odontobox-private'),

            /**
             * A identidade declarada — e isto LIGA a trava que estava inerte.
             *
             * `lib/identidade/guarda.ts` compara `APP_SLUG`/`APP_ENV` com a
             * sentinela `app_identity` do banco na primeira requisição de cada
             * isolate; sem as duas variáveis ela não faz nada, por desenho. A
             * ordem obrigatória era sentinela primeiro: `odontobox/production`
             * foi gravada e conferida por SQL em 29/10, e `odontobox/stg` na
             * branch staging do Neon no mesmo dia. Os previews apontam para o
             * banco de produção e herdam este config, então leem
             * `production` e casam com a sentinela de lá.
             *
             * É também o que faz `/api/_internal/identity` responder slug/env
             * de verdade — sem isto o smoke de identidade compararia
             * `undefined` com o manifesto.
             */
            APP_SLUG: bindings.text('odontobox'),
            APP_ENV: bindings.text('production'),

            /**
             * `auto` é o que o R2 espera como região da API S3. `lerConfig` a
             * trata como opcional, mas o SDK assina a requisição com ela — e
             * assinatura com região errada falha em tempo de execução.
             */
            PUBLIC_STORAGE_REGION: bindings.text('auto'),
            PRIVATE_STORAGE_REGION: bindings.text('auto'),

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
            /**
             * Todo tráfego de IA passa pelo **AI Gateway deste produto**.
             *
             * Um gateway por produto, compartilhado por staging e produção —
             * decisão do André em 2026-10-28. O que o portão dá: uso e custo
             * reais por chamada (é a base do débito de crédito, que hoje sai de
             * uma tabela de preços escrita no código), cache que paga as
             * retentativas da fila, teto de gasto e fallback de provedor.
             *
             * **Modo proxy, de propósito.** A chave da OpenAI continua indo na
             * requisição em vez de ficar guardada no portão (BYOK): guardá-la
             * exigiria um token Cloudflare de `AI Gateway Run`, e esse token
             * **não pode ser restrito a um gateway** — qualquer app da conta
             * poderia gastar a credencial dos outros. A saída documentada é o
             * binding `env.AI` do Worker, e é para lá que isto vai junto com o
             * Workers AI.
             */
            OPENAI_BASE_URL: bindings.text(
                'https://gateway.ai.cloudflare.com/v1/7ee4810a45580562977d68b86ec709e7/odontobox/openai'
            ),
            EVOLUTION_GO_API_KEY: bindings.secret(),
            /**
             * `GOOGLE_CLIENT_SECRET` saiu em 2026-10-21: é resquício, e nada o
             * lê. O `src/lib/google-oauth-client.ts` registra, no próprio
             * cabeçalho, que "none of it comes from the environment any more" —
             * as credenciais do app Google vêm de `platform_credentials` ou da
             * linha de integração do workspace.
             *
             * Exigi-lo aqui obrigaria a inventar um valor para publicar: ele
             * não existe no ambiente da VPS, conferido em 2026-10-21.
             */
            /**
             * Os `PLATFORM_*` NÃO entram aqui até existirem — e a ordem é lei.
             *
             * `bindings.secret()` não é "declaro que existe": é **exigência de
             * deploy**. Medido em 2026-10-24, publicando com os nove
             * declarados e nenhum gravado:
             *
             *     Error: The following required secrets have not been set:
             *     PLATFORM_ASAAS_CLIENT_ID, PLATFORM_ASAAS_CLIENT_SECRET, …
             *
             * E o outro lado é igualmente verdadeiro, porque esta configuração
             * é declarativa: **segredo gravado e não declarado é removido no
             * deploy seguinte.** As duas regras juntas dão uma ordem única, e
             * ela não pode inverter:
             *
             *   1. gravar o segredo:
             *      `npx wrangler secret put PLATFORM_ASAAS_CLIENT_ID --name odontobox`
             *   2. declará-lo aqui, no MESMO commit que o põe em uso;
             *   3. publicar.
             *
             * Inverter 1 e 2 derruba o deploy de `main` para todo mundo —
             * aconteceu, e é por isso que este comentário existe. Pular o 2
             * apaga a credencial no deploy seguinte, em silêncio, e o sintoma
             * aparece na primeira cobrança.
             *
             * Declare **um provedor por vez**, junto da configuração dele.
             * Nenhum está declarado hoje; a lista dos nomes e o comando de
             * gravação estão em `.env.example`, e `npm run check:cofre` confere
             * que todo `PLATFORM_` declarado aqui é um nome que o código lê.
             */
            /**
             * Asaas — gravados em 2026-10-25, declarados no mesmo movimento.
             *
             * `CLIENT_ID` é a chave de API; o ambiente sai do prefixo dela
             * (`$aact_hmlg_` sandbox, `$aact_prod_` produção), e por isso não
             * existe variável de ambiente para alguém marcar errado e cobrar de
             * verdade num teste. `CLIENT_SECRET` é o token do webhook, que não
             * é a chave de API: ele viaja em toda chamada para um endpoint
             * público e tem de ser igual ao que está no painel do Asaas.
             *
             * Declarados só agora porque a ordem é essa e não pode inverter —
             * ver o comentário acima. Os outros provedores entram cada um com a
             * sua configuração.
             */
            PLATFORM_ASAAS_CLIENT_ID: bindings.secret(),
            PLATFORM_ASAAS_CLIENT_SECRET: bindings.secret(),

            /**
             * Google Calendar — gravados pelo André em 2026-10-25, declarados
             * assim que apareceram em `wrangler secret list`.
             *
             * Estiveram gravados-e-não-declarados por uma janela, que é
             * exatamente o estado que o `WEBHOOK_BASE_URL` pagou em 23/10: o
             * deploy seguinte os teria removido, e o sintoma seria a tela
             * dizendo "pendente" para uma credencial que alguém lembra de ter
             * gravado.
             *
             * Os escopos que este par pede são `calendar.events` e
             * `userinfo.email` — ver `lib/google-oauth-client.ts`. Se a lista
             * do Console do Google divergir dali, o consentimento pede uma
             * coisa e o app outra.
             */
            PLATFORM_GOOGLE_CALENDAR_CLIENT_ID: bindings.secret(),
            PLATFORM_GOOGLE_CALENDAR_CLIENT_SECRET: bindings.secret(),

            PUBLIC_STORAGE_ACCESS_KEY_ID: bindings.secret(),
            PUBLIC_STORAGE_SECRET_ACCESS_KEY: bindings.secret(),

            /**
             * O bucket PRIVADO, `odontobox-private`.
             *
             * Entrou com a decisão de 2026-10-21 de levar o arquivo clínico
             * para o R2. Sem estes dois o adaptador lança
             * `ProvedorNaoConfiguradoError` em produção, e o sintoma aparece na
             * primeira foto que um paciente mandar — não no deploy.
             *
             * Não é binding de R2 e sim segredo de S3 porque o adaptador fala
             * API S3 (`src/lib/storage/s3.ts`), o que mantém a portabilidade
             * para outro provedor sem reescrever o caminho de leitura.
             */
            PRIVATE_STORAGE_ACCESS_KEY_ID: bindings.secret(),
            PRIVATE_STORAGE_SECRET_ACCESS_KEY: bindings.secret(),

            /**
             * Os endpoints da API S3 do R2 — `https://<ID_DA_CONTA>.r2.cloudflarestorage.com`.
             *
             * Segredo e não texto porque carregam o ID da conta, que o André
             * mantém como segredo (`CLOUDFLARE_ACCOUNT_ID` no GitHub). Os dois
             * recebem o MESMO valor: o endpoint é da conta, não do bucket — o
             * bucket entra pelo `_BUCKET` acima.
             */
            PUBLIC_STORAGE_ENDPOINT: bindings.secret(),
            PRIVATE_STORAGE_ENDPOINT: bindings.secret(),
        },

        ...(EH_PREVIEW ? {} : { triggers: GATILHOS }),
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
 *   - `SENSITIVE_STORAGE_*` **não entra mais**: a classe clínica foi para o
 *     R2 em 2026-10-21 e as credenciais dela são `PRIVATE_STORAGE_*`, já
 *     declaradas acima. O que falta nessa frente é a cifra na aplicação.
 *
 * **MIGRADO para Cloudflare Email Service** (2026-10-26): rota de envio via
 * `env.EMAIL` binding, rate limit por IP em memória do Workers, e destino
 * verificado em `mail.venn360.com`. Resend desativado.
 */
