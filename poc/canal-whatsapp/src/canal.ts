/// <reference types="@cloudflare/workers-types" />
import { Container } from '@cloudflare/containers'
import {
    decidirOcio,
    decidirReinicio,
    decidirVigia,
    JANELA,
    VIGIA,
    type EstadoObservado,
} from './decisoes'

export interface Ambiente {
    CANAL: DurableObjectNamespace<CanalWhatsApp>
    EVOLUTION_GO_API_KEY: string
    EVOGO_AUTH_DB: string
    EVOGO_USERS_DB: string
    WEBHOOK_BASE_URL: string
    /** Para onde o DO repassa os eventos — o webhook do app. */
    APP_WEBHOOK_URL: string
    /**
     * Service binding para o Worker do app (`odontobox`).
     *
     * O repasse de evento vai por aqui, não por `fetch` público do
     * `APP_WEBHOOK_URL`: um Worker buscando o `workers.dev` de outro Worker da
     * MESMA conta não atravessa de forma confiável (a borda trata como laço de
     * mesma zona), e o evento se perdia calado — medido em 2026-10-22. O binding
     * é o caminho que a Cloudflare recomenda, e o mesmo que a direção
     * app→contêiner já usa. Opcional: sem ele, cai no `fetch` público.
     */
    APP?: Fetcher
    POC_TOKEN: string
    /**
     * `'true'` reata as sessões gravadas ao subir.
     *
     * Padrão desligado de propósito: ver `CONNECT_ON_STARTUP` no construtor.
     * Com credencial real no banco, ligar isto enquanto a VPS serve tira número
     * de clínica do ar.
     */
    REATAR_SESSOES?: string
    /**
     * E-mail do primeiro registro manual da licença.
     *
     * Com ele o Evolution Go se ativa sozinho ao subir. É o que substitui tanto
     * o passo humano no `/manager` quanto a migração do `evogo_auth`.
     */
    EVOLUTION_OPERATOR_EMAIL?: string
}

/**
 * O tipo do estado vem do próprio construtor da classe base: `workers-types` e
 * `cloudflare:workers` declaram `DurableObjectState` com parâmetros diferentes,
 * e escrever o nome à mão quebra num dos dois.
 */
type EstadoDoObjeto = ConstructorParameters<typeof Container>[0]

/** Chaves do armazenamento do Durable Object — sobrevivem ao contêiner. */
const CHAVE = {
    /** Nome e token da instância do Evolution Go que este contêiner serve. */
    INSTANCIA: 'instancia',
    TOKEN: 'token',
    /** O nome da sala (id da integração), que o Worker passa no header. */
    SALA: 'sala',
    JID: 'jid',
    /**
     * Sticky: setado quando `loggedIn` é visto `true`, limpo só no logout real.
     *
     * Substitui `Boolean(jid)` como sinal de "há sessão a defender". Medido em
     * 2026-10-22: o Evolution Go 0.7.2 devolve `loggedIn:true` com `JID:""`, e
     * gatear pareamento no JID fazia a vigia hibernar uma sessão viva.
     */
    PAREADO: 'pareado',
    PAREOU_EM: 'pareouEm',
    ULTIMO_REINICIO: 'ultimoReinicio',
    FALHAS: 'falhas',
    /**
     * Se o webhook já foi (re)armado NESTA subida do contêiner.
     *
     * Resetado no `onStart`: o webhook do Evolution Go mora na requisição de
     * `/instance/connect` e **não sobrevive ao restart** (medido 2026-10-22) — a
     * sessão volta saudável, mas sem webhook, e o inbound para calado porque o
     * vigia só re-arma quando o socket cai. Ver `rearmarWebhook`.
     */
    WEBHOOK_ARMADO: 'webhookArmado',
    /** Quando o contêiner subiu — teto de tempo para o re-arme desistir. */
    BOOT_EM: 'bootEm',
    DIARIO: 'diario',
} as const

/**
 * Os mesmos eventos que a aplicação assina (`src/lib/whatsapp/evolution-go.ts`).
 * `CONTACT` entra porque é o balde onde a foto de perfil chega — não existe
 * `PICTURE` no vocabulário aceito.
 */
const EVENTOS_ASSINADOS = [
    'MESSAGE',
    'SEND_MESSAGE',
    'READ_RECEIPT',
    'CHAT_PRESENCE',
    'CONNECTION',
    'QRCODE',
    'CONTACT',
] as const

/** Quantas linhas de diário a POC guarda. É a prova que o André vai ler. */
const DIARIO_MAXIMO = 200

interface LinhaDoDiario {
    em: string
    o_que: string
    detalhe?: string
}

/**
 * Um contêiner de Evolution Go por workspace.
 *
 * Por que um por workspace e não um compartilhado como na VPS: o contorno do
 * defeito de pareamento é um reinício do processo, e na VPS esse reinício
 * derrubava a sessão de **todos** os clientes para consertar a de um. Aqui o
 * reinício atinge só quem pareou. O preço é linear no número de workspaces
 * pareados — a conta está em `decisoes.ts` e no relatório da POC.
 *
 * O que esta classe NÃO faz: decidir. Quando reiniciar, quando recusar
 * hibernar e o que o vigia faz saem das funções puras de `decisoes.ts`, que têm
 * teste nesta máquina (`npm run check:canal`). Aqui só se aplica o resultado,
 * porque este arquivo não pode ser executado localmente.
 */
export class CanalWhatsApp extends Container<Ambiente> {
    defaultPort = 8080

    /**
     * O cronômetro existe, mas quem decide é `onActivityExpired()`. Dez minutos
     * é só o ritmo em que a pergunta "pode dormir?" é feita.
     */
    sleepAfter = '10m'

    /** O WhatsApp é a razão de existir deste contêiner. */
    enableInternet = true

    /** O Evolution Go responde aqui quando está de pé. */
    pingEndpoint = 'localhost/server/ok'

    /**
     * `envVars` é propriedade da classe base, lida quando o contêiner sobe —
     * por isso é atribuída no construtor e não exposta como getter: TypeScript
     * recusa trocar propriedade por acessor, e a plataforma recusaria o valor
     * tarde demais.
     */
    constructor(ctx: EstadoDoObjeto, env: Ambiente) {
        super(ctx, env)

        this.envVars = {
            SERVER_PORT: '8080',
            CLIENT_NAME: 'odontobox360',
            GLOBAL_API_KEY: env.EVOLUTION_GO_API_KEY,

            // As credenciais do whatsmeow moram no Postgres, não no disco — é o
            // que faz o item 4 do roteiro passar sem snapshot: o disco do
            // contêiner é efêmero por definição e aqui não guarda nada que
            // importe.
            POSTGRES_AUTH_DB: env.EVOGO_AUTH_DB,
            POSTGRES_USERS_DB: env.EVOGO_USERS_DB,

            // Nós mesmos persistimos mensagens; uma segunda cópia aqui só
            // duplicaria a tabela e cresceria sem limite.
            DATABASE_SAVE_MESSAGES: 'false',

            // A mídia vem no próprio webhook, em base64 — é o que evita que uma
            // nota de voz atrase a resposta do agente.
            WEBHOOKFILES: 'true',
            MINIO_ENABLED: 'false',

            /**
             * Reatar as sessões ao subir.
             *
             * Em produção é `true`, e é o que torna o reinício um contorno
             * viável em vez de uma perda de sessão — o item 5 do roteiro
             * depende disto, não de sorte.
             *
             * **Na POC é `false` por padrão, e isso não é cautela genérica.**
             * A partir do momento em que esta POC aponta para um `evogo_users`
             * com credencial real, `true` faria este contêiner disputar o
             * aparelho com o Evolution Go que está no ar na VPS. O WhatsApp
             * aceita uma conexão por aparelho vinculado: os dois se derrubariam
             * em laço, e o desfecho provável é o aparelho ser **desvinculado** —
             * o número da clínica fora do ar, por causa de um teste.
             *
             * Só vale `true` aqui quando o `evolution-go` da VPS estiver
             * parado — ou seja, dentro da janela do corte.
             */
            CONNECT_ON_STARTUP: this.env.REATAR_SESSOES === 'true' ? 'true' : 'false',

            /**
             * Ativação da licença **sem navegador**.
             *
             * Do `.env.example` do projeto, literal: "Set this to the email you
             * used in your first manual license registration. On startup, the
             * service will silently call /v1/register/auto and skip the browser
             * flow. Falls back to the manual flow if the email isn't registered
             * yet."
             *
             * É o que tira a ativação do caminho crítico do corte. Com isto, a
             * licença deixa de ser **estado num banco que precisa ser migrado**
             * e passa a ser **configuração num segredo** — e o `evogo_auth` do
             * destino pode nascer vazio.
             *
             * Vazio aqui mantém o comportamento antigo (registro manual), então
             * não configurar não quebra nada.
             */
            ...(env.EVOLUTION_OPERATOR_EMAIL
                ? { EVOLUTION_OPERATOR_EMAIL: env.EVOLUTION_OPERATOR_EMAIL }
                : {}),

            WADEBUG: 'INFO',
            LOGTYPE: 'json',
        }
    }

    // ----------------------------------------------------------- diário

    private async registrar(o_que: string, detalhe?: string): Promise<void> {
        const diario = ((await this.ctx.storage.get<LinhaDoDiario[]>(CHAVE.DIARIO)) ?? []).slice(-DIARIO_MAXIMO + 1)
        diario.push({ em: new Date().toISOString(), o_que, detalhe })
        await this.ctx.storage.put(CHAVE.DIARIO, diario)
        console.log(`[canal ${this.ctx.id.toString().slice(0, 8)}] ${o_que}${detalhe ? ' — ' + detalhe : ''}`)
    }

    // ----------------------------------------------------- ganchos de vida

    override async onStart(): Promise<void> {
        await this.registrar('contêiner de pé')
        // Contêiner novo: o webhook do Evolution Go não sobrevive ao restart, e
        // precisa ser re-aplicado assim que a sessão logar (ver WEBHOOK_ARMADO).
        await this.ctx.storage.put(CHAVE.WEBHOOK_ARMADO, false)
        await this.ctx.storage.put(CHAVE.BOOT_EM, Date.now())
        // O vigia é reagendado a cada subida: um contêiner novo não herda o
        // agendamento do anterior.
        await this.schedule(VIGIA.INTERVALO_MS / 1000, 'ronda')
        // E o re-arme do webhook logo após subir, sem esperar a ronda (até 5 min).
        await this.schedule(40, 'rearmarWebhook')
    }

    override async onStop({ exitCode, reason }: { exitCode: number; reason: string }): Promise<void> {
        await this.registrar('contêiner parou', `código=${exitCode} razão=${reason}`)
    }

    override async onError(erro: unknown): Promise<never> {
        await this.registrar('falha ao subir', String(erro))
        throw erro
    }

    /**
     * O item 6 do roteiro da POC, e o único lugar onde o scale-to-zero é
     * recusado.
     *
     * A documentação da Cloudflare é explícita: não chamar `stop()` aqui faz o
     * cronômetro renovar e o gancho disparar de novo. Então permanecer de pé é
     * caminho previsto da plataforma, não truque — e a recusa é condicional de
     * propósito, porque workspace sem sessão pareada **deve** dormir. É o que
     * faz a conta seguir o número de clientes reais e não o de cadastros.
     */
    override async onActivityExpired(): Promise<void> {
        const jid = await this.ctx.storage.get<string>(CHAVE.JID)
        const pareouEm = await this.ctx.storage.get<number>(CHAVE.PAREOU_EM)
        const pareandoAgora = pareouEm !== undefined && Date.now() - pareouEm < JANELA.LOGOUT_MS

        const decisao = decidirOcio({ temAparelhoPareado: Boolean(jid), pareandoAgora })
        await this.registrar(`ócio: ${decisao.acao}`, decisao.motivo)

        if (decisao.acao === 'dormir') await this.stop()
    }

    // ------------------------------------------------- o contorno, agendado

    /**
     * Chamado quando o `PairSuccess` chega. Dispara a janela do reinício.
     */
    async pareou(): Promise<void> {
        await this.ctx.storage.put(CHAVE.PAREOU_EM, Date.now())
        await this.registrar('PairSuccess recebido', 'janela de reinício aberta')
        await this.schedule(1, 'avaliarReinicio')
    }

    /**
     * Re-arma o webhook logo após a subida do contêiner.
     *
     * O webhook some no restart (ver `armarWebhook`), e o vigia só re-arma no
     * socket caído — numa reconexão saudável ele nunca perceberia, e o inbound
     * pararia calado com a sessão de pé. Agendado pelo `onStart`: espera a sessão
     * logar e re-arma uma vez. Desiste após ~5 min (o `ronda` é a rede), para não
     * ficar acordando um contêiner que não tem sessão a defender.
     */
    async rearmarWebhook(): Promise<void> {
        if (await this.ctx.storage.get<boolean>(CHAVE.WEBHOOK_ARMADO)) return
        // Sem instância adotada não há webhook a armar.
        if (!(await this.ctx.storage.get<string>(CHAVE.TOKEN))) return

        const estado = await this.consultarInstancia()
        if (!estado.loggedIn) {
            const bootEm = (await this.ctx.storage.get<number>(CHAVE.BOOT_EM)) ?? 0
            if (Date.now() - bootEm < 5 * 60_000) await this.schedule(20, 'rearmarWebhook')
            return
        }

        try {
            await this.armarWebhook()
            await this.ctx.storage.put(CHAVE.WEBHOOK_ARMADO, true)
            await this.registrar('webhook re-armado', 'após subida do contêiner')
        } catch (erro) {
            await this.registrar('re-armar webhook falhou', String(erro))
        }
    }

    /**
     * Um passo da janela. Consulta o estado, pergunta à função pura e obedece.
     *
     * Reagenda a si mesmo em vez de dormir num laço: o Durable Object não deve
     * ficar segurando uma invocação por 70 s, e um alarme perdido é recuperável
     * enquanto um `await` perdido não é.
     */
    async avaliarReinicio(): Promise<void> {
        const pareouEm = await this.ctx.storage.get<number>(CHAVE.PAREOU_EM)
        if (pareouEm === undefined) return

        const estado = await this.consultarInstancia()
        // O JID é guardado quando vem (serve à reconexão), mas o que marca
        // "pareado" é o `loggedIn` — ver CHAVE.PAREADO.
        if (estado.jid) await this.ctx.storage.put(CHAVE.JID, estado.jid)
        if (estado.loggedIn) await this.ctx.storage.put(CHAVE.PAREADO, Date.now())

        const decisao = decidirReinicio({
            desdeParearMs: Date.now() - pareouEm,
            loggedIn: estado.loggedIn,
            jidConhecido: Boolean(estado.jid ?? (await this.ctx.storage.get<string>(CHAVE.JID))),
        })

        await this.registrar(
            `reinício: ${decisao.acao}`,
            `${decisao.motivo} (+${Math.round((Date.now() - pareouEm) / 1000)}s, loggedIn=${estado.loggedIn})`
        )

        if (decisao.acao === 'esperar') {
            await this.schedule(Math.max(1, Math.round(decisao.emMs / 1000)), 'avaliarReinicio')
            return
        }

        await this.ctx.storage.delete(CHAVE.PAREOU_EM)
        if (decisao.acao === 'reiniciar') await this.reiniciar('contorno pós-pareamento')
    }

    /**
     * O equivalente escopado do `docker restart` do host.
     *
     * SIGTERM e não SIGKILL: o desligamento gracioso deixa o whatsmeow fechar
     * os soquetes e devolver as conexões do Postgres — que é justamente o
     * segundo defeito medido (vazamento até esgotar `max_connections`).
     */
    private async reiniciar(motivo: string): Promise<void> {
        await this.registrar('reiniciando', motivo)
        await this.ctx.storage.put(CHAVE.ULTIMO_REINICIO, Date.now())
        await this.ctx.storage.put(CHAVE.FALHAS, 0)

        await this.stop('SIGTERM')
        // O contêiner pode ficar indisponível por um instante depois do sinal;
        // `startAndWaitForPorts` já traz espera de porta e nova tentativa.
        await this.startAndWaitForPorts({ cancellationOptions: { portReadyTimeoutMS: 60_000 } })
        await this.registrar('reiniciado')
    }

    // ---------------------------------------------------------- o vigia

    /** Substitui `wa-guard.sh` e `wa-pool-guard.sh` — os dois, num só lugar. */
    async ronda(): Promise<void> {
        const estado = await this.consultarInstancia()

        // O sinal de "há sessão a defender" é `loggedIn`, sticky em PAREADO — e
        // **não** o JID, que o 0.7.2 não devolve (medido 2026-10-22). Enquanto
        // logado, a sessão existe; só o logout de verdade a encerra.
        let pareado = await this.ctx.storage.get<number>(CHAVE.PAREADO)
        if (estado.respondeu && estado.loggedIn) {
            if (estado.jid) await this.ctx.storage.put(CHAVE.JID, estado.jid)
            if (!pareado) {
                pareado = Date.now()
                await this.ctx.storage.put(CHAVE.PAREADO, pareado)
                await this.registrar('vigia: sessão pareada detectada', 'loggedIn=true')
            }

            // Rede de segurança do re-arme pós-restart: se `rearmarWebhook` não
            // deu conta (desistiu após 5 min, ou a sessão demorou a voltar), o
            // vigia re-arma na primeira ronda em que a vir logada. O webhook some
            // no restart e sem ele o inbound para calado — ver WEBHOOK_ARMADO.
            if (!(await this.ctx.storage.get<boolean>(CHAVE.WEBHOOK_ARMADO))) {
                try {
                    await this.armarWebhook()
                    await this.ctx.storage.put(CHAVE.WEBHOOK_ARMADO, true)
                    await this.registrar('webhook re-armado', 'pelo vigia')
                } catch (erro) {
                    await this.registrar('re-armar webhook falhou', String(erro))
                }
            }
        }

        // Logout de verdade: o contêiner respondeu e diz que não está logado,
        // fora da janela de pareamento (essa é tratada por `avaliarReinicio`).
        // Aí a sessão acabou — limpa e deixa hibernar, em vez de reconectar em
        // laço um aparelho que o dono desvinculou.
        if (pareado && estado.respondeu && !estado.loggedIn && !estado.socketAberto) {
            await this.ctx.storage.delete(CHAVE.PAREADO)
            await this.ctx.storage.delete(CHAVE.JID)
            await this.registrar('vigia: sessão deslogou', 'hibernando — aparelho desvinculado')
            return
        }

        // Sem sessão pareada a ronda **encerra**, em vez de se reagendar.
        //
        // Não é economia de chamada: consultar o contêiner conta como atividade
        // e renova o cronômetro de ociosidade. Uma ronda a cada cinco minutos
        // contra um `sleepAfter` de dez manteria de pé — e cobrando — um
        // contêiner que não serve ninguém. A ronda volta sozinha: `onStart` a
        // reagenda na próxima subida, e a próxima subida é o primeiro pedido.
        if (!pareado) {
            await this.registrar('vigia: encerrado', 'sem sessão pareada; deixando o contêiner hibernar')
            return
        }

        const observado: EstadoObservado = !estado.respondeu
            ? 'sem-resposta'
            : estado.loggedIn && estado.socketAberto
              ? 'saudavel'
              : 'socket-caido'

        const falhas = observado === 'sem-resposta' ? ((await this.ctx.storage.get<number>(CHAVE.FALHAS)) ?? 0) + 1 : 0
        await this.ctx.storage.put(CHAVE.FALHAS, falhas)

        const ultimo = await this.ctx.storage.get<number>(CHAVE.ULTIMO_REINICIO)
        const decisao = decidirVigia({
            estado: observado,
            temAparelhoPareado: true,
            falhasSeguidas: falhas,
            desdeUltimoReinicioMs: ultimo === undefined ? null : Date.now() - ultimo,
        })

        if (decisao.acao !== 'nada' || observado !== 'saudavel') {
            await this.registrar(`vigia: ${decisao.acao}`, `${decisao.motivo} (observado=${observado})`)
        }

        if (decisao.acao === 'reconectar') await this.reconectar()
        if (decisao.acao === 'reiniciar') await this.reiniciar(decisao.motivo)

        await this.schedule(VIGIA.INTERVALO_MS / 1000, 'ronda')
    }

    // ------------------------------------------- conversa com o Evolution Go

    /**
     * Garante que existe uma instância, e devolve o token dela.
     *
     * A chave global do Evolution Go só serve para `/instance/create`; todos os
     * outros caminhos exigem o token da própria instância. Geramos o token aqui
     * em vez de aceitar o que o servidor atribui, pelo mesmo motivo que o
     * cliente da aplicação faz isso: perder o token órfã a instância, porque é
     * o único jeito de endereçá-la.
     */
    private async garantirInstancia(): Promise<string> {
        // Quem cria a instância é o APP (proxyada por aqui, e o token é farejado
        // no `/instance/create`). O DO só a ADOTA — então aqui ele devolve o
        // token guardado ou falha, sem criar nada por conta própria. Criar aqui
        // faria o DO ter uma instância que o app não conhece, e o webhook dela
        // nunca acharia a integração.
        const guardado = await this.ctx.storage.get<string>(CHAVE.TOKEN)
        if (guardado) return guardado
        throw new Error('instância não adotada: o app ainda não criou a linha neste contêiner')
    }

    private async consultarInstancia(): Promise<{
        respondeu: boolean
        loggedIn: boolean
        socketAberto: boolean
        jid?: string
    }> {
        const mudo = { respondeu: false, loggedIn: false, socketAberto: false }
        const token = await this.ctx.storage.get<string>(CHAVE.TOKEN)
        // Sem instância criada não há o que consultar, e criar uma aqui faria o
        // vigia inventar instância num contêiner que ninguém pediu.
        if (!token) return mudo

        try {
            const r = await this.containerFetch('http://localhost/instance/status', {
                headers: { apikey: token },
            })
            if (!r.ok) return mudo
            const envelope = (await r.json()) as { data?: Record<string, unknown> }
            const corpo = envelope.data ?? (envelope as unknown as Record<string, unknown>)
            return {
                respondeu: true,
                loggedIn: Boolean(corpo.LoggedIn),
                socketAberto: Boolean(corpo.Connected),
                jid: typeof corpo.JID === 'string' && corpo.JID ? corpo.JID : undefined,
            }
        } catch {
            return mudo
        }
    }

    /**
     * Aplica o webhook (e a assinatura) no Evolution Go via `/instance/connect`.
     *
     * É o único lugar onde o webhook é definido — e ele **não sobrevive ao
     * restart** do contêiner (mora na requisição, não no banco; medido
     * 2026-10-22). Por isso não serve só à reconexão de socket caído: o contêiner
     * também re-aplica ao subir (ver `rearmarWebhook`/`ronda`). Em sessão logada,
     * reemitir o connect re-arma o webhook sem derrubar a sessão (medido).
     */
    private async armarWebhook(): Promise<void> {
        const token = await this.garantirInstancia()
        await this.containerFetch('http://localhost/instance/connect', {
            method: 'POST',
            headers: { apikey: token, 'content-type': 'application/json' },
            body: JSON.stringify({
                immediate: true,
                webhookUrl: await this.webhook(),
                subscribe: EVENTOS_ASSINADOS,
            }),
        })
    }

    private async reconectar(): Promise<void> {
        try {
            await this.armarWebhook()
        } catch (erro) {
            await this.registrar('reconexão falhou', String(erro))
        }
    }

    /**
     * O webhook carrega o segredo no caminho.
     *
     * O Evolution Go não manda cabeçalho de autenticação nos webhooks, então o
     * único lugar onde um segredo caberia é a URL. Não é ideal — URL vaza em
     * log —, mas a alternativa é um endpoint público que aceita evento de
     * qualquer um, e na POC ele dispara reinício de contêiner.
     */
    private async webhook(): Promise<string> {
        // A sala (id da integração) vem do header que o Worker põe; na ausência
        // dela cai no id do objeto, que ao menos roteia de volta para cá.
        const sala = (await this.ctx.storage.get<string>(CHAVE.SALA)) ?? this.ctx.id.toString()
        return `${this.env.WEBHOOK_BASE_URL}/entrada/${this.env.POC_TOKEN}/${sala}`
    }

    // ----------------------------------------------------------- roteamento

    /**
     * Toda exceção vira linha de diário antes de virar resposta.
     *
     * `wrangler tail` não conecta desta máquina (o WebSocket cai antes de
     * estabelecer), então o diário no armazenamento do objeto é a única
     * observabilidade que a POC tem de perto. Engolir a exceção aqui seria
     * cegueira; registrá-la e devolvê-la ao chamador já autenticado é o que
     * permite diagnosticar sem `tail`.
     */
    override async fetch(pedido: Request): Promise<Response> {
        try {
            return await this.rotear(pedido)
        } catch (erro) {
            const detalhe = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro)
            await this.registrar('exceção na rota', detalhe)
            return Response.json({ erro: detalhe }, { status: 500 })
        }
    }

    private async rotear(pedido: Request): Promise<Response> {
        const url = new URL(pedido.url)

        if (url.pathname === '/poc/estado') {
            const [pareado, ultimo, falhas, pareouEm] = await Promise.all([
                this.ctx.storage.get<number>(CHAVE.PAREADO),
                this.ctx.storage.get<number>(CHAVE.ULTIMO_REINICIO),
                this.ctx.storage.get<number>(CHAVE.FALHAS),
                this.ctx.storage.get<number>(CHAVE.PAREOU_EM),
            ])
            return Response.json({
                contêiner: await this.getState(),
                instância: await this.consultarInstancia(),
                pareado: Boolean(pareado),
                pareandoDesde: pareouEm ? new Date(pareouEm).toISOString() : null,
                últimoReinício: ultimo ? new Date(ultimo).toISOString() : null,
                falhasSeguidas: falhas ?? 0,
            })
        }

        if (url.pathname === '/poc/diario') {
            return Response.json((await this.ctx.storage.get<LinhaDoDiario[]>(CHAVE.DIARIO)) ?? [])
        }

        if (url.pathname === '/poc/pareou' && pedido.method === 'POST') {
            await this.pareou()
            return Response.json({ ok: true })
        }

        // --- API do Evolution Go, pela sala do app ----------------------
        //
        // O Worker põe `x-evo-sala`; o DO a guarda para saber o próprio nome —
        // é com ela que monta o webhook e se endereça na reconexão.
        const salaHeader = pedido.headers.get('x-evo-sala')
        if (salaHeader && !(await this.ctx.storage.get<string>(CHAVE.SALA))) {
            await this.ctx.storage.put(CHAVE.SALA, salaHeader)
        }

        // `/instance/connect`: o DO REESCREVE o `webhookUrl` para o SEU
        // `/entrada`, para o segredo do webhook nunca sair daqui. O app manda o
        // que mandar; o que vale é o deste contêiner.
        if (url.pathname === '/instance/connect' && pedido.method === 'POST') {
            const corpo = (await pedido.json().catch(() => ({}))) as Record<string, unknown>
            corpo.webhookUrl = await this.webhook()
            corpo.subscribe = EVENTOS_ASSINADOS
            corpo.immediate = corpo.immediate ?? true
            return this.containerFetch('http://localhost/instance/connect', {
                method: 'POST',
                headers: { apikey: pedido.headers.get('apikey') ?? '', 'content-type': 'application/json' },
                body: JSON.stringify(corpo),
            })
        }

        // `/instance/create`: proxia e FAREJA o token no corpo da resposta, para
        // a vigia (consultar/reconectar) poder agir depois sem o app reenviá-lo.
        if (url.pathname === '/instance/create' && pedido.method === 'POST') {
            const r = await this.containerFetch(pedido)
            try {
                const corpo = (await r.clone().json()) as { data?: { name?: string; token?: string } }
                if (corpo.data?.token) {
                    await this.ctx.storage.put(CHAVE.TOKEN, corpo.data.token)
                    await this.ctx.storage.put(CHAVE.INSTANCIA, corpo.data.name ?? '')
                    await this.registrar('instância adotada', corpo.data.name ?? '')
                }
            } catch {
                // corpo não-JSON (erro, 503 de licença…): nada a farejar.
            }
            return r
        }

        // Tudo o mais (envio, status, qr, mídia…) proxia direto.
        return this.containerFetch(pedido)
    }
}
