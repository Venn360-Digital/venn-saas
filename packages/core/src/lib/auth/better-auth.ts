import 'server-only'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import prisma from '@venn/db/cliente'
import { renderEmail } from '../email/layout'
import { sendEmail } from '../email/send'
import { APP } from '../../config/app'
import { BRAND } from '../../marca'

/**
 * O Better Auth, montado sobre o schema que já existe.
 *
 * Substitui o provedor de identidade anterior. A diferença que importa não é de API: é que a
 * identidade deixa de ser um serviço externo e passa a ser **tabela no mesmo
 * banco** — o que torna a sessão resolvível pelo Worker sem ida à rede, e torna
 * o usuário juntável com `WorkspaceUser` numa consulta só.
 *
 * **A restrição que manda no desenho: os ids têm de sobreviver.** `User.id` é
 * chave estrangeira em quase todo o schema — `WorkspaceUser`, `Activity`,
 * `Deal`, `Conversation`, `Account.ownerUserId` — e os valores atuais são os
 * UUID que vinham do `auth.users` daquele provedor. Gerar id novo seria reescrever o
 * banco inteiro. Então o Better Auth é apontado para a tabela `users` que já
 * existe e **não** gera id: quem gera é o `@default(cuid())` do Prisma, para
 * quem chegar agora, e quem já existe mantém o UUID.
 */
/**
 * Construída **sob demanda**, não na carga do módulo.
 *
 * `betterAuth()` valida a configuração ao ser chamada — inclusive exige
 * `BETTER_AUTH_SECRET`, e com razão: segredo de assinatura com valor padrão é
 * sessão forjável. Mas no escopo do módulo isso acontecia durante o
 * `next build`, que importa toda rota para análise estática e não tem segredo
 * nenhum. O build imprimia cinco `BetterAuthError` e terminava com êxito — que
 * é o pior desfecho possível, porque treina quem lê o log a ignorar erro.
 *
 * Preguiçosa resolve dois problemas de uma vez: o build deixa de depender de um
 * segredo que ele não usa, e o Worker deixa de pagar a construção no arranque
 * frio de uma requisição que talvez nem toque autenticação.
 */
let instancia: ReturnType<typeof construir> | null = null

export function getAuth(): ReturnType<typeof construir> {
    instancia ??= construir()
    return instancia
}

/**
 * A origem usada quando o host da requisição não é determinável.
 *
 * Existe porque sem ela a biblioteca **lança** — e o link do e-mail de
 * redefinição de senha é montado a partir do `baseURL`. Falhar ali deixaria a
 * pessoa sem caminho de volta.
 *
 * **Vem da MARCA — não de um literal, e não de `APP().url`.**
 *
 * O literal era identidade de um app dentro de código que vai servir os três:
 * hoje é inofensivo porque há um app só, e no segundo passa a ser falha de
 * segurança — este valor é o `fallback` que o Better Auth usa para decidir de
 * onde aceita a requisição, então os apps irmãos herdariam o controle de CSRF
 * deste.
 *
 * **Por que NÃO `APP().url`, que foi a minha primeira tentativa.** Parecia
 * melhor: o padrão dele já é `https://${BRAND().appHost}`, e em homologação
 * apontaria para o host de stg em vez de mandar a pessoa para produção. O
 * portão reprovou, e com razão — no builder `APP().url` vale
 * `http://localhost:3000`, porque a variável está no ambiente de build. Ou
 * seja: `APP().url` é **configurável por ambiente**, e com ele o fallback de
 * CSRF passaria a depender de uma variável que pode ser gravada errada. É
 * exatamente a causa do incidente de 2026-10-23 — `NEXT_PUBLIC_APP_URL` gravada
 * com valor que não batia com a origem real, e o acesso caiu — documentado
 * algumas linhas abaixo, que eu havia acabado de ler quando errei.
 *
 * A marca é identidade: mora em código, o `typecheck` a vê, e não há como
 * gravá-la errada num segredo. O ajuste de homologação que eu queria sai do
 * `APP().env`, que é enum validado, de modo que o resultado é **sempre** um
 * host que `hostsPermitidos()` aceita — e é isso que a asserção do `check:auth`
 * passou a cobrar.
 *
 * (Este comentário não nomeia os apps irmãos de propósito: `audit:isolation`
 * reprova identificador de outro app em `packages/**` **inclusive em
 * comentário**, e com razão — foi comentário copiado que vazou nome de app duas
 * vezes antes desta. Os valores medidos ficam na mensagem do commit.)
 *
 * Função e não `const`: `APP()` chama `BRAND()`, que é fail-fast, e um `const`
 * de módulo o executaria quando a Cloudflare AVALIA o script para validá-lo —
 * antes de existir requisição, portanto antes de alguém registrar a marca. Foi
 * assim que duas publicações reprovaram em 14/11; `check:marca-tardia` agora
 * pega essa forma.
 */
export function origemDeReserva(): string {
    const host = APP().env === 'stg' ? `homolog-${BRAND().appHost}` : BRAND().appHost
    return `https://${host}`
}

/**
 * Os hosts cuja origem o Better Auth aceita da requisição.
 *
 * Exportada para `scripts/check-auth.ts` poder provar as invariantes — a lista
 * errada aqui não quebra o build, quebra o login, e foi exatamente assim que o
 * acesso caiu em 2026-10-23. As asserções de lá derivam da marca registrada,
 * não de literais, para valerem igual nos três apps.
 *
 * O loopback entra **só fora de produção**: em desenvolvimento o servidor é
 * `localhost:3000` e sem ele o login local resolveria para a origem de reserva,
 * ou seja apontaria para produção. Medido em 2026-10-24: o curinga de porta
 * (`localhost:*`) casa `localhost:3000` e `localhost:3001`, e **não** casa
 * `localhost` sem porta nem `127.0.0.1:3000` — por isso os dois padrões.
 *
 * Se o guarda falhar e o loopback valer em produção, o estrago é pequeno: um
 * atacante teria de mandar `Host: localhost:3000` ao Worker, e o que ele
 * conseguiria é um redirecionamento para a própria máquina dele.
 */
export function hostsPermitidos(): string[] {
    /**
     * O host canônico **do app que registrou a marca** — não um literal.
     *
     * Era o host de produção escrito como literal. **Medido nos três repos em
     * 14/11, antes de derivar**: em todos eles o host de autenticação é o
     * `appHost` da marca, o de homologação é exatamente `homolog-` + esse
     * valor, e o curinga de preview é o mesmo `*.andre-7ee.workers.dev` —
     * porque a conta Cloudflare é uma só. A derivação abaixo é fato medido, não
     * padrão suposto; os valores conferidos estão na mensagem do commit, que
     * não é varrida pelo `audit:isolation`.
     */
    const canonico = BRAND().appHost
    return [
    canonico,
    /**
     * **O host de homologação, que faltava.**
     *
     * Achado em 2026-11-09 com o Andre sem conseguir entrar: `/login` em
     * `homolog-odontobox.venn360.com` respondia **403 `INVALID_ORIGIN`** a todo
     * `sign-in`, porque `getTrustedOrigins` deriva desta lista e o host não
     * estava nela. Ninguém conseguia entrar em homologação pelo navegador —
     * desde que o host nasceu, em 03/11.
     *
     * **E `curl` não via.** Sem cabeçalho `Origin`, a mesma requisição voltava
     * 401 `INVALID_EMAIL_OR_PASSWORD`, que parece saúde. A confusão de origem
     * só aparece quando o pedido traz a origem — ou seja, só no navegador.
     * Quem for sondar login daqui tem de mandar `-H "Origin: https://<host>"`,
     * senão prova a coisa errada.
     *
     * Em código e não em variável, pela mesma razão que o domínio oficial: o
     * host fica ao lado da lista que o autoriza, o `typecheck` vê os dois, e
     * `scripts/check-auth.ts` exige os dois.
     */
    `homolog-${canonico}`,
    // Os previews por PR — `pr-<n>-odontobox.andre-7ee.workers.dev`. O
    // subdomínio estável (`odontobox.andre-7ee...`) está desligado por
    // `workersDev: false`, então isto alcança só as versões de revisão.
    '*.andre-7ee.workers.dev',
    ...(process.env.NODE_ENV === 'production' ? [] : ['localhost:*', '127.0.0.1:*']),
    /**
     * Escape por ambiente, sem deploy: `TRUSTED_ORIGINS` (CSV) entra aqui.
     *
     * Serve para um host novo — um domínio próprio de cliente, um preview fora
     * do padrão — ser aceito gravando um segredo, em vez de esperar build. O
     * padrão é lista vazia, então não muda nada hoje.
     *
     * Ele NÃO substitui os quatro de cima, e isso é deliberado: o incidente de
     * 09/11 (login de homologação em 403 `INVALID_ORIGIN` por seis dias) e o de
     * 23/10 (`NEXT_PUBLIC_APP_URL` gravada com valor errado) foram os dois por
     * host de autenticação depender de configuração. O que o app precisa para
     * funcionar fica em código, derivado da marca, com `check:auth` cobrando.
     */
    ...APP().trustedOrigins,
    ]
}

function construir() {
    return betterAuth({
        database: prismaAdapter(prisma, { provider: 'postgresql' }),

        /**
         * `BETTER_AUTH_SECRET` assina os cookies de sessão.
         *
         * Em produção vem do Cloudflare Secrets. Sem ele a biblioteca recusa subir,
         * que é o comportamento certo — segredo de assinatura com valor padrão é
         * sessão forjável.
         */
        secret: process.env.BETTER_AUTH_SECRET,

        /**
         * A origem, por host permitido — e **não** por variável de ambiente.
         *
         * ## O que estava errado
         *
         * Era `baseURL: process.env.NEXT_PUBLIC_APP_URL`, e a variável não
         * existe: o Worker emitia
         * `WARN [Better Auth]: Base URL is not set` em quase toda requisição, e
         * a biblioteca passava a derivar a origem do host de **cada
         * requisição** — qualquer host que alcançasse o Worker valia como
         * origem para cookie e redirecionamento. Com `auditoria`, era também o
         * motivo de `trustedOrigins` ficar vazio.
         *
         * ## Por que não é uma string fixa
         *
         * Porque quebraria os previews, que mudam de hostname a cada PR
         * (`pr-<n>-odontobox.andre-7ee.workers.dev`) — e é neles que o fluxo de
         * login é testado. O arquivo do cliente já avisa disso em
         * `lib/auth/cliente.ts`, e é por isso que ele usa `basePath` relativo
         * em vez de host.
         *
         * ## Por que não é segredo
         *
         * Porque em 2026-10-23 gravar `NEXT_PUBLIC_APP_URL` como segredo do
         * Worker **derrubou o acesso ao sistema**: o valor virou o `baseURL` do
         * Better Auth e não batia com a origem real. Um segredo a mais é um
         * valor a mais para divergir do host que serve de fato, e a divergência
         * se manifesta como "não consigo entrar". Em código, o host está ao
         * lado da lista que o autoriza, e o `typecheck` vê os dois.
         *
         * ## O que esta forma faz
         *
         * A configuração dinâmica (`allowedHosts`) resolve a origem do host da
         * requisição **depois de conferi-lo contra a lista** — host fora dela
         * cai no `fallback`. E `getTrustedOrigins` deriva `trustedOrigins`
         * desta mesma lista, então isto também fecha a ausência de
         * `trustedOrigins` que a auditoria apontou: uma mudança, dois achados.
         *
         * O curinga foi medido no matcher do próprio pacote (2026-10-24):
         * `*.andre-7ee.workers.dev` casa `pr-41-odontobox.andre-7ee.workers.dev`,
         * **não** casa `odontobox.venn360.com` — por isso o domínio oficial
         * está listado à parte — e **não** casa
         * `evil.andre-7ee.workers.dev.evil.com`, ou seja não cai em falsificação
         * de sufixo. Ele atravessa ponto (`a.b.andre-7ee...` casa), o que é mais
         * largo que o ideal mas segue confinado ao subdomínio da própria conta.
         *
         * O `fallback` existe para o caso de o host não ser determinável: sem
         * ele a biblioteca **lança**, e o link do e-mail de redefinição de senha
         * é montado a partir daqui — falhar ali deixaria a pessoa sem caminho de
         * volta.
         */
        baseURL: {
            allowedHosts: hostsPermitidos(),
            fallback: origemDeReserva(),
        },

        user: {
            /**
             * O modelo do Prisma, não o nome da tabela — o adapter fala com o
             * Prisma, e o `@@map("users")` já cuida do nome no banco.
             */
            modelName: 'User',
            fields: {
                // O Better Auth chama de `image` o que este schema chama de
                // `avatar`. Mapear em vez de renomear a coluna: `avatar` aparece em
                // tela, em rota e no adaptador de storage.
                image: 'avatar',
            },
        },

        /**
         * Os três modelos próprios da biblioteca, renomeados — e o do meio é um
         * conserto, não estilo.
         *
         * **`Account` já existe neste schema e é outra coisa.** Aqui `Account` é a
         * conta que assina: tem `name` obrigatório, CNPJ, endereço de cobrança,
         * `asaasCustomerId`. O `Account` do Better Auth é o par credencial-provedor
         * de um usuário — onde mora o hash da senha. Deixar os dois no mesmo modelo
         * é o que o próprio CLI apontou ao gerar o schema:
         *
         *     Required columns Better Auth never writes
         *       account.name
         *     Inserts into account will fail.
         *
         * Ou seja: todo cadastro falharia, porque a biblioteca não tem o que
         * escrever em `name` e a coluna é obrigatória. E se `name` fosse afrouxado
         * para resolver, o resultado seria pior — credencial de login e conta de
         * cobrança misturadas na mesma tabela, com `ownerUserId` apontando para
         * linha de senha.
         *
         * `Session` e `Verification` não colidem com nada hoje, mas ganham o mesmo
         * prefixo: as três são da biblioteca, e o prefixo diz isso sem precisar
         * abrir o arquivo.
         */
        session: {
            modelName: 'AuthSession',

            /**
             * Quatro horas, renovada a cada hora de uso.
             *
             * O padrão da biblioteca é **sete dias**. Numa clínica o computador da
             * recepção é compartilhado e fica ligado: sete dias significa que quem
             * sentar nele amanhã continua logado como a atendente de ontem, com
             * acesso a prontuário.
             *
             * Era oito horas; o Andre pediu quatro em 2026-11-07. Com `updateAge`
             * de uma hora, quem está trabalhando tem a sessão renovada sozinha e
             * não é interrompido — então isto é um limite de **quatro horas de
             * inatividade**, não de jornada. Quem passa o dia na tela não desloga;
             * a máquina esquecida ligada no almoço, sim.
             *
             * O número também tem efeito de custo, e foi medido em 2026-11-07: a
             * aba aberta consulta o banco a cada 15 s, e isso impede o Neon de
             * suspender (o ociosidade dele é de 5 min). Deslogar antes encurta a
             * janela em que uma aba esquecida mantém o compute de pé — mas é
             * paliativo, porque o `fetch` da tela não para só porque a sessão
             * expirou: o conserto de verdade é pausar o polling com a aba oculta.
             *
             * É um número, e muda em uma linha se a operação pedir outro.
             */
            expiresIn: 60 * 60 * 4,
            updateAge: 60 * 60,
        },
        account: { modelName: 'AuthAccount' },
        verification: { modelName: 'AuthVerification' },

        emailAndPassword: {
            enabled: true,
            /**
             * Sem verificação de e-mail no primeiro corte.
             *
             * O cadastro está aberto de propósito desde 2026-10-07 para homologação,
             * e exigir verificação agora somaria um fluxo de e-mail ao corte que já
             * troca banco, cofre, storage e identidade. Entra junto com o portão de
             * cadastro, antes do lançamento.
             */
            requireEmailVerification: false,
            minPasswordLength: 8,

            /**
             * O e-mail de redefinição de senha.
             *
             * **Sem isto o botão "esqueci minha senha" não faz nada** — a biblioteca
             * grava o token e chama este gancho para entregá-lo; sem gancho, o token
             * fica no banco e a pessoa nunca recebe o link. Foi o estado em que esta
             * configuração nasceu, e é por isso que ele vem junto e não depois.
             *
             * O `url` já vem montado com o `redirectTo` que a tela de login passou e
             * com o token na query — `/nova-senha?token=…`, que é quem o gasta.
             */
            sendResetPassword: async ({ user, url }) => {
                const resultado = await sendEmail({
                    to: user.email,
                    subject: `Redefinir sua senha — ${BRAND().name}`,
                    html: renderEmail({
                        headline: 'Redefinir sua senha',
                        body: [
                            'Alguém — provavelmente você — pediu para trocar a senha desta conta.',
                            'O link vale por uma hora e serve uma vez só.',
                            'Se não foi você, ignore este e-mail. A senha atual continua valendo e nada muda.',
                        ],
                        cta: { texto: 'Escolher nova senha', url },
                        rodape: 'Se o botão não abrir, copie e cole este endereço no navegador: ' + url,
                    }),
                })

                /**
                 * Falha de envio: registrada em ERRO, e **só**.
                 *
                 * Medido em 2026-10-21: a biblioteca chama este gancho por
                 * `runInBackgroundOrAwait`, então o que se lança aqui **não** chega à
                 * resposta HTTP — `requestPasswordReset` devolve 200 de qualquer
                 * forma. Lançar daria a falsa impressão de que a tela saberia; não
                 * daria.
                 *
                 * Então a tela diz "se esse e-mail tiver conta, o link chegou" — que
                 * é verdade sobre o que ela sabe, e é deliberadamente igual para
                 * e-mail que não existe, para não virar um verificador de quem é
                 * cliente da clínica.
                 *
                 * **A consequência operacional, dita em voz alta:** falha de entrega
                 * é invisível para quem pediu e aparece só nesta linha de log. Antes
                 * do lançamento isto precisa de um sinal — contador de falha de envio
                 * na vigia de integrações, que já existe para o Asaas. Registrado em
                 * `docs/migration/03-go-no-go.md`.
                 */
                if (!resultado.ok) {
                    console.error('[AUTH] falha ao enviar redefinição de senha:', resultado.error)
                }
            },

            /**
             * Uma hora de validade.
             *
             * O padrão da biblioteca é maior. Uma hora é tempo de abrir o e-mail e
             * não é tempo de o link ficar válido numa caixa de entrada compartilhada
             * da recepção — que é o cenário real numa clínica.
             */
            resetPasswordTokenExpiresIn: 3600,
        },

        /**
         * O limite de requisições, **em banco** e não em memória.
         *
         * Este é o único item desta configuração que estaria errado em produção se
         * fosse deixado no padrão, e o motivo é o destino: a biblioteca liga o
         * limite sozinha em produção, mas com `storage: "memory"` — que é
         * literalmente um `new Map()` no módulo (conferido em
         * `api/rate-limiter/index.mjs`).
         *
         * Em Cloudflare Workers isso não limita nada. Cada isolate carrega o módulo
         * de novo e tem o próprio mapa; os isolates são muitos, espalhados por colo,
         * e descartados com frequência. O limite efetivo passaria a ser
         * "100 por janela **por isolate**", que para quem tenta adivinhar senha é o
         * mesmo que não haver limite — e `/sign-in/email` é endpoint público.
         *
         * Em banco o contador é um só, compartilhado por todos os isolates, e vive
         * no mesmo Postgres que a sessão.
         */
        rateLimit: {
            enabled: true,
            storage: 'database',
            modelName: 'AuthRateLimit',

            /** O padrão geral, para o que não tem regra própria. */
            window: 10,
            max: 100,

            /**
             * Os endpoints que um atacante repetiria, com limite apertado.
             *
             * O padrão de 100 em 10 s é razoável para uso normal e generoso demais
             * para adivinhação: a 100 tentativas por 10 segundos, uma lista de dez
             * mil senhas comuns passa em menos de vinte minutos.
             */
            customRules: {
                // Entrar: 10 tentativas por minuto. Quem erra a senha tenta três
                // vezes, não dez — e quem tenta dez por minuto não é a pessoa.
                '/sign-in/email': { window: 60, max: 10 },
                // Pedir redefinição: 5 por hora. Protege a conta e protege a nossa
                // reputação de remetente, que um disparo em massa queimaria.
                '/request-password-reset': { window: 3600, max: 5 },
                '/forget-password': { window: 3600, max: 5 },
                // Gastar token de redefinição: 10 por hora. Adivinhar token é
                // inviável por entropia, mas o limite fecha a porta de vez.
                '/reset-password': { window: 3600, max: 10 },
                // Cadastrar: 5 por hora. O cadastro está aberto para homologação
                // (ver `public-signup-open`), e sem limite isso é um criador de
                // contas em massa.
                '/sign-up/email': { window: 3600, max: 5 },
                // Trocar senha exige a atual: é um oráculo de senha se não limitado.
                '/change-password': { window: 600, max: 10 },
            },
        },

        advanced: {
            database: {
                /**
                 * O banco gera os ids, não a biblioteca.
                 *
                 * É o que preserva os UUID existentes e o que mantém `cuid()` como a
                 * forma dos novos, igual ao resto do schema. Ver a nota do módulo.
                 */
                generateId: false,
            },

            /**
             * T5 — cookies host-only, com prefixo por app.
             *
             * `cookiePrefix` vem de `AUTH_COOKIE_PREFIX`. Na OdontoBox fica
             * **vazio de propósito**: `undefined` mantém o default da biblioteca
             * (`better-auth`), então as sessões ativas NÃO caem. Os apps novos
             * setam o próprio slug. Trocar o prefixo renomeia o cookie e desloga
             * todo mundo uma vez — por isso só muda quando a var muda.
             *
             * `crossSubDomainCookies` **desativado** (cookie sem atributo
             * `Domain`): todos os produtos vivem sob `venn360.com`, e um cookie
             * com `Domain=.venn360.com` vazaria sessão entre produtos. O default
             * da lib já é desativado; aqui fica explícito para não depender disso.
             *
             * `useSecureCookies` NÃO é setado aqui: o default da lib já marca
             * Secure em https/produção, e forçá-lo sem poder validar em staging
             * arriscaria o cookie em preview. Fica para a validação da Fase 03.
             */
            cookiePrefix: APP().authCookiePrefix || undefined,
            crossSubDomainCookies: { enabled: false },
        },
    })
}

/**
 * Compatibilidade para quem já importava `auth`.
 *
 * `Proxy` e não `getAuth()` chamado aqui: chamar na carga do módulo anularia a
 * preguiça inteira. O proxy repassa cada acesso para a instância, construída na
 * primeira vez que alguém lê uma propriedade — que é, na prática, a primeira
 * requisição que precisa de autenticação.
 *
 * **O trap `has` não é decoração, e a falta dele derrubava o cadastro inteiro
 * no Worker.** Medido em 2026-10-22: `/api/auth/sign-up/email` respondia 500 com
 * `TypeError: e is not a function`.
 *
 * A causa: `toNextJsHandler(auth)` testa `'handler' in auth`, e o operador `in`
 * usa o trap `has`. Sem ele a checagem cai no ALVO do proxy, que é `{}`
 * literal — então `'handler' in auth` dava **false**, o `toNextJsHandler`
 * concluía que o próprio `auth` era o handler, e devolvia `{ GET: auth, POST:
 * auth }`. O vinext então chamava um objeto como se fosse função.
 *
 * O `bind` existe pelo mesmo motivo de fundo: `Reflect.get` devolve método
 * **desligado**, e chamá-lo solto perde o `this` da instância. Com um proxy, o
 * que não é repassado explicitamente não falha com erro claro — falha num
 * lugar distante, com mensagem minificada.
 */
export const auth = new Proxy({} as ReturnType<typeof construir>, {
    get(_alvo, prop) {
        const instancia = getAuth()
        const valor = Reflect.get(instancia as object, prop)
        return typeof valor === 'function' ? valor.bind(instancia) : valor
    },

    has(_alvo, prop) {
        return prop in (getAuth() as object)
    },

    getOwnPropertyDescriptor(_alvo, prop) {
        const d = Reflect.getOwnPropertyDescriptor(getAuth() as object, prop)
        // `configurable: true` é exigência do invariante de Proxy: o alvo é `{}`
        // e não tem a propriedade, então declará-la não-configurável lançaria.
        return d ? { ...d, configurable: true } : undefined
    },

    ownKeys() {
        return Reflect.ownKeys(getAuth() as object)
    },
})

export type Sessao = ReturnType<typeof construir>['$Infer']['Session']
