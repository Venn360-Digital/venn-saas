import { bindings, defineConfig, defineWorker, exports, triggers } from 'cf/config'

import * as entrypoint from './src/cloudflare/entrada.ts' with { type: 'cf-worker' }
import { cronsParaWrangler } from '@venn/core/lib/cron/agenda'
import { ALL_QUEUES, TENTATIVAS } from '@venn/core/lib/queue/definitions'

/**
 * A configuração do Worker do Stagent360.
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
 * O ambiente do deploy. Sem valor vale `production`, de propósito: todo caminho
 * que existe hoje — o build de produção e o preview — **não** passa
 * `DEPLOY_ENV`, e cair em produção mantém o comportamento atual intacto. Só o
 * staging é opt-in, via `DEPLOY_ENV=stg` em `build:stg`/`deploy:stg`.
 */
const DEPLOY_ENV = ((): 'production' | 'stg' => {
    const v = process.env.DEPLOY_ENV ?? 'production'
    if (v !== 'production' && v !== 'stg')
        throw new Error(`DEPLOY_ENV deve ser 'production' ou 'stg' (recebido: ${v})`)
    return v
})()

/** `prod` | `stg` — o sufixo que os recursos deste app carregam. */
const ENV_TAG = DEPLOY_ENV === 'production' ? 'prod' : 'stg'

/**
 * O nome do Worker, e ele é a IDENTIDADE do recurso na Cloudflare.
 *
 * O Worker de produção tem o nome LIMPO (`stagent`), decidido em 01/11/2026 —
 * e é o único recurso deste produto que não leva sufixo de ambiente. Ver a nota
 * de `PREFIXO_RECURSOS` logo abaixo, que é onde essa assimetria é explicada.
 *
 * **Tem de estar certo antes do primeiro deploy.** Não existe renomear Worker
 * no Cloudflare: publicar com nome novo cria OUTRO Worker, e o antigo fica com
 * os Durable Objects, as filas vinculadas e a rota. Trocar depois significa
 * migrar estado de DO, não editar um campo.
 */
const NOME = DEPLOY_ENV === 'production' ? 'stagent' : `stagent-${ENV_TAG}`

/**
 * ⚠️ O prefixo leva o sufixo de ambiente NOS DOIS LADOS — `stagent-prod-*` em
 * produção, `stagent-stg-*` em homologação — e o nome do Worker NÃO.
 *
 * Não é inconsistência: é o que a conta TEM. Os buckets e as filas deste
 * produto nasceram com o sufixo antes de o Worker de produção existir, e o
 * Worker ganhou o nome limpo depois. Bucket não se renomeia, e fila renomeada é
 * fila nova: `PREFIXO_RECURSOS = NOME` — que é o que vale no produto cujo
 * Worker nasceu primeiro — faria este deploy procurar
 * `stagent-whatsapp-inbound`, que não existe. O `cf` a CRIARIA, vazia, e o que
 * estivesse em voo nas filas reais ficaria sem consumidor.
 *
 * Levantado na conta antes de escrever este arquivo, e conferido contra
 * `infra/manifest/stagent.json` pelo `check:recursos`, que é quem reprova a
 * divergência antes do publish.
 */
const PREFIXO_RECURSOS = `stagent-${ENV_TAG}`

/** O hostname que serve o ambiente. Produção veio primeiro e não tem sufixo. */
const HOST = DEPLOY_ENV === 'production' ? 'stagent.venn360.com' : 'homolog-stagent.venn360.com'

/**
 * O host do Evolution, **igual nos dois ambientes**: há um contêiner por
 * produto, nunca por ambiente. O que separa produção de homolog é o webhook,
 * que é por instância, e o `EVOLUTION_WEBHOOK_SECRET`, que é próprio de cada um.
 */
const EVOLUTION_BASE = 'https://evo-stagent.venn360.com'

/** O nome da fila na conta, a partir do nome lógico. */
const naConta = (fila: string) => `${PREFIXO_RECURSOS}-${fila}`

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
    'ses-event': {
        retryDelay: 2,
        /**
         * Recibo de e-mail, igual ao de WhatsApp: barato e numeroso — até nove
         * por e-mail enviado. Agrupar troca latência (que ninguém percebe num
         * relatório) por muito menos invocação.
         *
         * Lote menor que o do WhatsApp porque cada evento aqui faz uma consulta
         * por `sesMessageId` e, em bounce ou reclamação, ainda chama o SES para
         * suprimir. Vinte e cinco desses numa invocação se aproximariam do teto
         * de CPU.
         */
        maxBatchSize: 10,
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
         * Um consumidor por fila — a lista sai de `ALL_QUEUES`, então uma
         * fila nova entra aqui sozinha.
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
        /**
         * Em homologação, só os de uma vez por dia — ver `cronsParaWrangler`.
         *
         * Medido em 2026-11-07: os Workers `-stg` registravam a agenda inteira
         * de produção, e o compute de homologação consumia **mais** que o de
         * produção num app sem usuários. A regra está na agenda, não aqui,
         * porque é decisão de produto sobre cadência — e porque `check:filas`
         * compara a lista gerada com a tabela do código.
         */
        ...cronsParaWrangler(DEPLOY_ENV).map((schedule) => triggers.scheduled({ schedule })),
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
         * **A porta lateral fechada.** O subdomínio `<worker>.andre-7ee.workers.dev`
         * servia o app inteiro — e não é da zona `venn360.com`.
         *
         * Isso é o que torna o subdomínio um problema de segurança e não só de
         * estética: regra de WAF, rate limiting, Bot Management e Access vivem
         * **na zona**. Nada do que se configure em `venn360.com` alcança um
         * hostname `workers.dev`. Fechar a porta da frente e deixar a lateral
         * aberta é configurar a borda para ninguém.
         *
         * Medido em 2026-10-24 no primeiro produto a fechar esta porta: **todo**
         * webhook de entrada do WhatsApp chegava pelo hostname `workers.dev`,
         * porque era o valor gravado em `WEBHOOK_BASE_URL` — a mensagem de quem
         * a organização atende entrava pela porta sem borda. Depois de trocar o
         * segredo e reconectar a linha, o inbound passou a chegar pelo hostname
         * da zona; foi essa prova que liberou desligar isto. A medição é do
         * primeiro produto de propósito: a política é a mesma nos três, e o
         * incidente não se repetiu porque a ordem abaixo foi respeitada.
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

        /**
         * Os logs do Worker, guardados — e isto nasceu de uma investigação que
         * **não deu para fazer**.
         *
         * Em 2026-11-13 um defeito de produção precisava de uma linha que o
         * código já escreve: `[CONTACT_LOOKUP]` diz, a cada consulta de telefone
         * na tela de novo atendimento, se a ficha existia, o que o provedor
         * respondeu sobre o número ter WhatsApp e se havia canal conectado. Essa
         * linha existe há meses. O que não existia era onde lê-la: sem
         * `observability`, o Worker só emite para `wrangler tail`, que é ao vivo
         * — ou seja, só se descobre o que aconteceu se alguém estiver olhando no
         * instante em que acontece.
         *
         * O efeito prático era pedir ao cliente que **reproduzisse o defeito sob
         * encomenda** para a gente ver. Para um defeito intermitente — e o deste
         * caso depende de o Evolution responder — isso é o mesmo que não ter
         * diagnóstico.
         *
         * Declarado aqui, e não pelo painel: a API de settings do Worker exige o
         * payload inteiro, e um PATCH parcial foi **recusado** por derrubar a
         * declaração dos Durable Objects. A recusa estava certa, e é a razão de
         * isto morar na configuração, que é a fonte da verdade e sobrevive ao
         * próximo deploy.
         */
        observability: { enabled: true, logs: { enabled: true } },

        /**
         * O domínio, declarado aqui e não só preso pelo painel.
         *
         * Medido em 2026-11-02 nos clones: quando a config remota e a local
         * divergem, o `cf deploy` **aborta** — e a única saída seria publicar
         * sobrescrevendo, o que **apagaria** um domínio que existe só no
         * remoto. Aqui isso seria a produção saindo do ar.
         *
         * `previews: false` porque as URLs de versão usam outro mecanismo
         * (`previewUrls` acima); subdomínio de preview neste hostname serviria
         * tráfego real de preview, que é o que não se quer.
         */
        domains: [{ hostname: HOST, production: true, previews: false }],

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

            /**
             * O motor do funil de vendas.
             *
             * `steps: 1000` e não 100: o teto conta **passos do Workflow**, e
             * uma volta do motor gasta de dois a três (ler, fazer, às vezes
             * dormir). O desenho cabe em 100 passos de funil, então mil é o
             * mesmo número com a folga certa — e `MAX_TRANSICOES` em
             * `lib/funil/passos.ts` corta antes, com motivo gravado, em vez de
             * a plataforma matar a instância sem explicação.
             *
             * **Sem `schedules`.** Quem entra num funil é um gatilho de
             * produto (etiqueta, etapa, lista, contato novo), não o relógio.
             *
             * `errorRetention` maior que `successRetention` de propósito: a
             * instância que deu certo não tem o que investigar, e a que falhou
             * é a única fonte de qual passo parou — a tabela guarda o motivo,
             * não o rastro.
             */
            MotorDoFunil: exports.workflow({
                /**
                 * Prefixado como todo recurso daqui, e por um motivo que custou
                 * um deploy de produção em 2026-11-09: **o nome do Workflow é
                 * único por conta**. Sem prefixo, o primeiro ambiente a
                 * publicar toma o nome e o segundo não publica mais — foi o que
                 * aconteceu, com o staging tomando `funil-de-vendas` às 11:18 e
                 * a produção falhando o publish às 14:57, depois de a migração
                 * já ter aplicado.
                 */
                name: `${PREFIXO_RECURSOS}-funil-de-vendas`,
                limits: { steps: 1000 },
                defaultRetention: { successRetention: '7 days', errorRetention: '30 days' },
            }),
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
            EMAIL_FROM: bindings.text('Stagent360 <noreply@mail.venn360.com>'),

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
             * O motor do funil, pelo próprio nome do Worker.
             *
             * Binding e não import, como todo o resto da plataforma aqui: quem
             * cria instância é o Worker, e a aplicação a alcança pela costura
             * `registrarMotorDoFunil` (ver `src/trabalhos/funil.ts`).
             */
            FUNIL: bindings.workflow({
                // `name` repete o nome declarado no export acima — é assim que o
                // binding acha o Workflow na conta, e o nome é único por conta.
                // Daí o prefixo: ver o comentário no export.
                name: `${PREFIXO_RECURSOS}-funil-de-vendas`,
                worker: NOME,
                exportName: 'MotorDoFunil',
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
            SES_EVENT: bindings.queue({ name: naConta('ses-event') }),
            CRON: bindings.queue({ name: naConta('cron') }),

            /**
             * R2 — público **e**, desde 2026-10-21, clínico.
             *
             * Este comentário dizia "somente conteúdo público" e que o clínico
             * era recusado até um provedor brasileiro ser aprovado. **Mudou por
             * decisão do André:** o arquivo sensível vai para o bucket privado
             * deste app, aqui no R2 mesmo.
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
             * O bucket PÚBLICO, `<prefixo>-public`.
             *
             * O nome sai de `PREFIXO_RECURSOS`, e por isso carrega o sufixo de
             * ambiente nos dois lados neste produto — ver a nota daquela
             * constante, que é onde a assimetria está explicada. Os nomes são o
             * que a conta TEM: o `check:recursos` os confere contra
             * `infra/manifest/stagent.json` antes de qualquer publish.
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
             * `EVOLUTION_GO_URL` é o hostname do Tunnel, e **não é segredo** —
             * era declarado como tal, com a justificativa de "topologia da rede",
             * e isso não resistiu à conferência de 03/11: o host é registro
             * PÚBLICO de DNS na zona (`CNAME … cfargotunnel.com`, proxied), já
             * aparece em texto claro no `infra/manifest/<app>.json` versionado, e o
             * próprio `/api/internal/identity` o devolve na resposta. Quem
             * protege o Evolution é o Cloudflare Access, não o desconhecimento
             * do nome.
             *
             * Classificar como segredo custava três coisas: o valor não podia
             * ser lido de volta, entrava na lista do que precisa rotacionar, e
             * divergia dos apps irmãos, que já o declaravam como texto — com
             * este mesmo comentário desatualizado herdado na clonagem.
             *
             * `EVOLUTION_WEBHOOK_SECRET` é outra história e continua segredo: é
             * o que o Evolution no VPS carrega no caminho do webhook para a app
             * autenticar a entrada (ver `src/app/api/webhooks/evolution-go/[secret]`).
             */
            EVOLUTION_GO_URL: bindings.text(EVOLUTION_BASE),
            EVOLUTION_WEBHOOK_SECRET: bindings.secret(),

            /**
             * O service token do Cloudflare Access, para alcançar o Tunnel.
             *
             * O Tunnel já tirava a porta do VPS, mas o hostname publicado
             * respondia a **qualquer um na internet** — a API e o manager
             * inteiros do Evolution Go, atrás de uma `apikey` só. Medido na
             * auditoria de 2026-10-23. A aplicação do Access em
             * `evo-stagent.venn360.com` tem política de **Service Auth**, e
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
             * Continua segredo, mas **não** pelo motivo que estava escrito aqui
             * ("mesmo motivo de `EVOLUTION_GO_URL`"): aquele motivo caiu em
             * 03/11, e este valor também é público (é o próprio host do app).
             * Fica como está por uniformidade — os três apps irmãos o declaram
             * como segredo —, e reclassificá-lo é trabalho separado, com uma
             * consequência própria: o valor muda quando o domínio virar, e o
             * linha do Evolution é o que o rearme reaplica, então trocá-lo
             * exige reconectar as linhas (ver `infra/scripts/wa-webhook-guard.sh`).
             */
            WEBHOOK_BASE_URL: bindings.secret(),

            PUBLICO: bindings.r2({ name: `${PREFIXO_RECURSOS}-public` }),

            // Variáveis, só o que não é segredo.
            TZ: bindings.text('America/Sao_Paulo'),
            LOG_LEVEL: bindings.text('info'),

            /**
             * O Venn Desk — a central de suporte, que é OUTRO serviço, com
             * repositório, Worker e banco próprios.
             *
             * `VENN_DESK_APP` é como este app se identifica lá, e é o que faz
             * cada chamado nascer com o `app_id` certo. `VENN_DESK_BASE` é onde
             * a central responde, e muda com o ambiente: homologação deste app
             * fala com a central de homologação, porque abrir chamado de teste
             * na fila de produção é poluir o trabalho de quem atende.
             *
             * Texto, não segredo: os dois valores são públicos — o primeiro é o
             * slug que já está no cofre e na semente do Desk, o segundo é um
             * host que o navegador vê em toda chamada do widget.
             *
             * **Ausência é desligamento, não falha.** Sem estas variáveis o
             * painel não desenha o botão de suporte e a rota de token responde
             * 503 — o app segue inteiro. É o que permite subir o widget num app
             * de cada vez.
             */
            VENN_DESK_APP: bindings.text('stagent'),
            VENN_DESK_BASE: bindings.text(
                DEPLOY_ENV === 'production'
                    ? 'https://desk.venn360.com'
                    : 'https://venn-desk.andre-7ee.workers.dev'
            ),

            /**
             * A metade PRIVADA do par Ed25519 com que este app assina quem está
             * pedindo suporte. O Venn Desk conhece só a pública, e é por isso
             * que ele confia na identidade sem ler o banco de app nenhum.
             *
             * **A ordem importa, e esta declaração é exigência.** Declarado e
             * não gravado REPROVA o deploy (ver `CF_ACCESS_CLIENT_ID` acima).
             * Grave antes, com `bash scripts/chave-do-desk.sh`, que leva a
             * chave do cofre aos seis Workers sem ela passar por tela nenhuma.
             */
            VENN_DESK_CHAVE_PRIVADA: bindings.secret(),

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
            PUBLIC_STORAGE_BUCKET: bindings.text(`${PREFIXO_RECURSOS}-public`),
            PRIVATE_STORAGE_BUCKET: bindings.text(`${PREFIXO_RECURSOS}-private`),

            /**
             * A identidade declarada — e isto LIGA a trava que estava inerte.
             *
             * `lib/identidade/guarda.ts` compara `APP_SLUG`/`APP_ENV` com a
             * sentinela `app_identity` do banco na primeira requisição de cada
             * isolate; sem as duas variáveis ela não faz nada, por desenho. A
             * ordem obrigatória é sentinela primeiro: `stagent/production` no
             * banco de produção e `stagent/stg` na branch staging do Neon, as
             * duas gravadas e conferidas por SQL antes de este config entrar em
             * uso. Os previews apontam para o banco de produção e herdam este
             * config, então leem `production` e casam com a sentinela de lá.
             *
             * É também o que faz `/api/internal/identity` responder slug/env
             * de verdade — sem isto o smoke de identidade compararia
             * `undefined` com o manifesto.
             */
            APP_SLUG: bindings.text('stagent'),
            APP_ENV: bindings.text(DEPLOY_ENV),

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
             * O envio de **campanha** de e-mail, pelo Amazon SES.
             *
             * O transacional continua no binding `EMAIL` acima e nada aqui o
             * toca. Campanha é outro problema: ela sai do **domínio do
             * cliente**, e o Email Sending da Cloudflare exige que o domínio de
             * envio seja zona da nossa conta — ver o cabeçalho de
             * `src/lib/email/ses.ts` para os três fatos que descartaram esse
             * caminho.
             *
             * Chave e não binding porque SES é HTTPS assinado, não recurso da
             * plataforma: chega por `process.env`, como `OPENAI_API_KEY`.
             *
             * **A ausência é estado válido.** Um app onde a campanha de e-mail
             * ainda não foi ligada não tem estas chaves, e o código responde
             * "não configurado" (503) em vez de quebrar — por isso elas não
             * entram em nenhuma trava de boot. Ver `infra/runbook/17-ses-credenciais.md`.
             */
            SES_ACCESS_KEY_ID: bindings.secret(),
            SES_SECRET_ACCESS_KEY: bindings.secret(),
            /**
             * Região e configuration set têm padrão no código (`sa-east-1` e
             * `venn-<slug>`), então são texto e só mudam quando se foge da
             * convenção. Declarados aqui para ficarem visíveis junto do resto.
             */
            SES_REGION: bindings.text('us-east-2'),
            SES_CONFIGURATION_SET: bindings.text('venn-stagent'),
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
                'https://gateway.ai.cloudflare.com/v1/7ee4810a45580562977d68b86ec709e7/stagent/openai'
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
             *      `npx wrangler secret put PLATFORM_ASAAS_CLIENT_ID --name stagent`
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
            /**
             * ⚠️ ASAAS NÃO ENTRA NESTE APP — decisão do André em 18/11/2026: o
             * stagent cobra por **Stripe**, numa fase própria.
             *
             * `PLATFORM_ASAAS_CLIENT_ID` e `PLATFORM_ASAAS_CLIENT_SECRET`
             * estiveram declarados aqui por herança: a estrutura deste arquivo
             * veio do molde do primeiro app na Fase 3 ("estrutura do monorepo,
             * identidade do clone"), e as declarações vieram de carona. O
             * Worker nunca teve os valores, então o primeiro `cf deploy` deste
             * app a partir do monorepo reprovou com
             *
             *     The following required secrets have not been set:
             *     PLATFORM_ASAAS_CLIENT_ID, PLATFORM_ASAAS_CLIENT_SECRET
             *
             * que é a guarda funcionando: `bindings.secret()` é EXIGÊNCIA de
             * deploy, não anotação. O desvio foi gravar valores só para
             * desbloquear — e eles nem servem, porque o que estava no cofre é
             * um `client_id` da era OAuth (36 caracteres, sem `$aact_`), que
             * `ambienteDaChave` classifica como `desconhecido` e faz
             * `asaasConfig()` devolver `null`.
             *
             * Retirando a declaração, o deploy deste app deixa de exigir os
             * dois, e a produção não precisa de chave Asaas nenhuma.
             *
             * ⚠️ CORREÇÃO, medida em 18/11/2026: eu escrevi aqui que "segredo
             * gravado e não declarado é removido no deploy seguinte", repetindo
             * a afirmação que está no config do primeiro app. **Não se
             * reproduziu.** O deploy rodou com esta declaração já removida e os
             * dois secrets continuaram no Worker — 22 antes, 22 depois.
             *
             * O que a medição sustenta é só a outra metade: **declarado e não
             * gravado REPROVA o deploy** (foi o que aconteceu aqui). A remoção
             * automática não aconteceu para `secret_text` nesta versão do `cf`,
             * e `keepVars` governa `vars`, não segredo.
             *
             * Então valores inertes saem **à mão**:
             *     npx wrangler secret delete PLATFORM_ASAAS_CLIENT_ID --name stagent-stg
             *
             * A prática de declarar no mesmo commit que põe em uso continua
             * certa — ela protege da metade que É real. O que muda é não contar
             * com uma limpeza que o deploy não faz.
             *
             * Quando o Stripe entrar: gravar o segredo, declarar aqui no MESMO
             * commit que o põe em uso, publicar. A ordem é lei — está no
             * comentário acima e já derrubou o deploy de `main` uma vez.
             */

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
             * O bucket PRIVADO, `<prefixo>-private`.
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
