/**
 * Prova o Better Auth contra um Postgres de verdade.
 *
 * Confere o que decide se a troca de provedor de identidade é segura, e não só
 * se ela compila:
 *
 *   - o **id** vem do banco (`cuid()`), não da biblioteca. É o que preserva os
 *     UUID que já existem — `User.id` é chave estrangeira em quase todo o
 *     schema, e id novo significaria reescrever o banco;
 *   - o **hash** mora em `auth_accounts.password` e `users.hashedPassword`
 *     segue nula, para não haver dois lugares guardando senha;
 *   - o cookie é **HttpOnly** e **SameSite**, e um cookie forjado não resolve
 *     sessão nenhuma;
 *   - senha errada é recusada **e não cria sessão** — as duas coisas, porque
 *     recusar e mesmo assim abrir sessão já aconteceu em biblioteca de
 *     autenticação;
 *   - `CASCADE` leva sessões e credenciais ao apagar a pessoa: credencial órfã
 *     é credencial que ainda autentica.
 *
 * Cria e apaga o que usa, sempre em `@odontobox360.test`. Nunca aponte para
 * produção:
 *
 *     DATABASE_URL='<homologação>' BETTER_AUTH_SECRET='<qualquer>' npm run check:auth
 */
import { HOSTS_PERMITIDOS, ORIGEM_DE_RESERVA, auth } from '@/lib/auth/better-auth'
import { codificarEstado, lerEstado } from '@/lib/instagram/oauth'
import prisma from '@venn/db/cliente'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

async function main() {
    // ====================================================== a origem aceita
    /**
     * As invariantes da lista de hosts — **sem banco**, de propósito.
     *
     * Lista errada aqui não quebra o build: quebra o **login**. Foi assim que o
     * acesso caiu em 2026-10-23, quando `NEXT_PUBLIC_APP_URL` foi gravada como
     * segredo com um valor que não batia com a origem real. O `typecheck` não
     * tem como ver isso, então vê aqui.
     *
     * Não é um teste do matcher do Better Auth — aquele é da biblioteca. É um
     * teste de que **a nossa lista** continua dizendo o que queremos.
     */
    ok(
        'o domínio oficial está entre os hosts aceitos',
        HOSTS_PERMITIDOS.includes('odontobox.venn360.com'),
        HOSTS_PERMITIDOS.join(', ')
    )
    /**
     * O host de homologação, que faltou de 03/11 a 09/11 e deixou o login de
     * homolog respondendo 403 `INVALID_ORIGIN` no navegador. A asserção existe
     * porque a falta não quebra build, lint nem `curl` sem `Origin`.
     */
    ok(
        'o host de homologação está na lista',
        HOSTS_PERMITIDOS.includes('homolog-odontobox.venn360.com'),
        HOSTS_PERMITIDOS.join(', ')
    )
    ok(
        'nenhum padrão aceita host qualquer',
        !HOSTS_PERMITIDOS.some((h) => h.trim() === '*' || h.trim() === '*.*'),
        'um `*` solto devolveria a origem do atacante e anularia o controle'
    )
    ok(
        'a origem de reserva é o domínio oficial, em https',
        ORIGEM_DE_RESERVA === 'https://odontobox.venn360.com',
        ORIGEM_DE_RESERVA
    )

    /**
     * Em produção, nenhum host de loopback.
     *
     * O recorte é por `NODE_ENV`, então esta asserção só tem conteúdo quando o
     * script roda com `NODE_ENV=production`. No CI ele não roda assim, e por
     * isso a mensagem diz qual dos dois casos foi conferido — asserção que
     * passa por vacuidade sem avisar é portão oco.
     */
    const comLoopback = HOSTS_PERMITIDOS.filter((h) => /^(localhost|127\.)/.test(h))
    if (process.env.NODE_ENV === 'production') {
        ok('em produção não há loopback entre os hosts', comLoopback.length === 0, comLoopback.join(', '))
    } else {
        ok(
            'fora de produção o loopback está lá (senão o login local aponta para produção)',
            comLoopback.length > 0,
            `NODE_ENV=${process.env.NODE_ENV ?? '(vazio)'} — a regra de produção não foi exercitada aqui`
        )
    }

    // ============================== o destino de volta do OAuth do Instagram
    /**
     * `voltarPara` é **caminho interno ou nada** — sem banco, de propósito.
     *
     * Ele chega dentro do `state`, que viaja pelo navegador e qualquer um
     * reescreve. O callback monta o destino com `new URL(voltaCom(...), base)`,
     * então um absoluto resolvia para fora. E os ramos de erro chamam `voltar()`
     * **antes** de autenticar: bastava `?state=<b64>&error=x` para um link que
     * começa em `odontobox.venn360.com` levar ao site do atacante. É a isca que
     * faz phishing funcionar, e por isso a prova mora junto das de identidade.
     */
    {
        const PADRAO = '/atendimento/agentes/integracoes'
        const base = { agentId: 'ag1', workspaceId: 'ws1', userId: 'u1' }
        const destino = (voltarPara: unknown) =>
            lerEstado(codificarEstado({ ...base, voltarPara } as never))?.voltarPara

        const recusados: Array<[string, unknown]> = [
            ['absoluto', 'https://evil.example/'],
            ['esquema-relativo', '//evil.example/x'],
            ['barra invertida', '/\\evil.example'],
            ['javascript:', 'javascript:alert(1)'],
            ['sem barra inicial', 'evil.example'],
            ['vazio', ''],
            ['não é string', 42],
        ]
        for (const [rotulo, valor] of recusados) {
            ok(`volta do Instagram recusa ${rotulo}`, destino(valor) === PADRAO, String(destino(valor)))
        }
        ok('e aceita caminho interno', destino('/vendas/pacientes') === '/vendas/pacientes')
    }

    /**
     * O contador do limite é zerado antes de começar.
     *
     * O limite está **sempre ligado** na configuração, de propósito — não há
     * interruptor de ambiente que o desligue, porque interruptor que desliga
     * controle de segurança um dia fica desligado no lugar errado. A
     * consequência é que a suíte consome quota: `/sign-up/email` admite 5 por
     * hora, e rodar isto duas vezes seguidas bateria no teto.
     *
     * Zerar aqui também **prova que a tabela está em uso**: se o limite ainda
     * fosse em memória, esta limpeza não teria efeito nenhum e o teste de
     * estrangulamento mais abaixo falharia.
     */
    await prisma.authRateLimit.deleteMany({})

    const email = `prova-${Date.now()}@odontobox360.test`
    const senha = 'senha-de-prova-12345'

    // 1. Cadastro: cria a linha em `users` e a credencial em `auth_accounts`.
    const cadastro = await auth.api.signUpEmail({
        body: { email, password: senha, name: 'Pessoa de Prova' },
        asResponse: true,
    })
    ok('signUpEmail responde 200', cadastro.ok, `HTTP ${cadastro.status}`)

    // O cadastro **já emite sessão**: o Better Auth faz login automático ao
    // cadastrar. Importa para a tela — não há segundo passo de login depois de
    // criar a conta.
    ok(
        'cadastro já emite cookie de sessão (login automático)',
        (cadastro.headers.get('set-cookie') ?? '').includes('better-auth')
    )

    const usuario = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, name: true, emailVerified: true, hashedPassword: true },
    })
    ok('linha criada em users', usuario !== null)
    ok('nome gravado', usuario?.name === 'Pessoa de Prova', String(usuario?.name))
    ok('emailVerified começa false', usuario?.emailVerified === false)

    // O id tem de ser cuid do Prisma, não id da biblioteca — é o que preserva
    // os UUID existentes, que são chave estrangeira em quase todo o schema.
    ok('id gerado pelo banco (cuid)', /^c[a-z0-9]{20,}$/.test(usuario?.id ?? ''), usuario?.id ?? '')

    // 2. O hash mora em auth_accounts, e NÃO em users.hashedPassword.
    const credencial = await prisma.authAccount.findFirst({
        where: { userId: usuario!.id },
        select: { providerId: true, accountId: true, password: true },
    })
    ok('credencial criada em auth_accounts', credencial !== null)
    ok('providerId é "credential"', credencial?.providerId === 'credential', String(credencial?.providerId))
    ok('hash gravado', (credencial?.password?.length ?? 0) > 20)
    ok('hash NÃO é a senha em claro', !credencial?.password?.includes(senha))
    ok('users.hashedPassword segue nula', usuario?.hashedPassword === null)

    // 3. Login com a senha certa devolve sessão.
    const login = await auth.api.signInEmail({
        body: { email, password: senha },
        asResponse: true,
    })
    ok('signInEmail responde 200', login.ok, `HTTP ${login.status}`)

    const cookie = login.headers.get('set-cookie') ?? ''
    ok('cookie de sessão emitido', cookie.includes('better-auth'), cookie.split(';')[0])
    ok('cookie é HttpOnly', /HttpOnly/i.test(cookie))
    ok('cookie é SameSite', /SameSite/i.test(cookie))

    // Duas sessões: a do cadastro e a deste login. Medido, não fixado — foi
    // exatamente aqui que eu supus "uma" e o teste acusou.
    const sessoes = await prisma.authSession.count({ where: { userId: usuario!.id } })
    ok('login grava sessão adicional no banco', sessoes === 2, `${sessoes} sessões`)

    // 4. Senha errada é recusada — e a sessão não aparece.
    const errada = await auth.api.signInEmail({
        body: { email, password: 'senha-errada-12345' },
        asResponse: true,
    })
    ok('senha errada é recusada', !errada.ok, `HTTP ${errada.status}`)
    ok(
        'senha errada não cria sessão',
        (await prisma.authSession.count({ where: { userId: usuario!.id } })) === sessoes,
        `segue em ${sessoes}`
    )

    // 5. A sessão é resolvível pelo cookie — é o que o middleware vai fazer.
    const sessao = await auth.api.getSession({
        headers: new Headers({ cookie: cookie.split(';')[0] }),
    })
    ok('getSession resolve pelo cookie', sessao?.user?.id === usuario!.id)
    ok('sessão carrega o e-mail', sessao?.user?.email === email)

    // 6. Cookie inválido não resolve nada.
    const forjada = await auth.api.getSession({
        headers: new Headers({ cookie: 'better-auth.session_token=valor-inventado' }),
    })
    ok('cookie forjado não resolve sessão', forjada === null)

    // 7. Senha curta é recusada (minPasswordLength: 8).
    const curta = await auth.api.signUpEmail({
        body: { email: `curta-${Date.now()}@odontobox360.test`, password: 'abc', name: 'X' },
        asResponse: true,
    })
    ok('senha curta é recusada', !curta.ok, `HTTP ${curta.status}`)

    // 8. E-mail repetido é recusado.
    const repetido = await auth.api.signUpEmail({
        body: { email, password: senha, name: 'Outra Pessoa' },
        asResponse: true,
    })
    ok('e-mail repetido é recusado', !repetido.ok, `HTTP ${repetido.status}`)

    // 8b. O ciclo completo de redefinição de senha.
    //
    // O token não vai para o `value`: ele vai para o `identifier`, na forma
    // `reset-password:<token>` — e `value` guarda o id do usuário. Descoberto
    // sondando, porque errar isto faria o script de corte gerar links que não
    // abrem.
    const emailReset = `reset-${Date.now()}@odontobox360.test`
    await auth.api.signUpEmail({
        body: { email: emailReset, password: 'senha-inicial-12345', name: 'Reset' },
        asResponse: true,
    })

    const pedido = await auth.api.requestPasswordReset({
        body: { email: emailReset, redirectTo: 'http://localhost:3000/nova-senha' },
        asResponse: true,
    })
    ok('requestPasswordReset responde 200', pedido.ok, `HTTP ${pedido.status}`)

    const verif = await prisma.authVerification.findFirst({
        where: { identifier: { startsWith: 'reset-password:' } },
        orderBy: { createdAt: 'desc' },
    })
    ok('token gravado em auth_verifications', verif !== null)

    const minutos = verif ? Math.round((verif.expiresAt.getTime() - Date.now()) / 60000) : 0
    ok('validade é de uma hora', minutos >= 55 && minutos <= 60, `${minutos} min`)

    const token = verif!.identifier.replace('reset-password:', '')
    const novaSenha = 'senha-redefinida-12345'
    const trocou = await auth.api.resetPassword({
        body: { newPassword: novaSenha, token },
        asResponse: true,
    })
    ok('resetPassword aceita o token', trocou.ok, `HTTP ${trocou.status}`)

    const comNova = await auth.api.signInEmail({
        body: { email: emailReset, password: novaSenha },
        asResponse: true,
    })
    ok('senha nova entra', comNova.ok, `HTTP ${comNova.status}`)

    const comAntiga = await auth.api.signInEmail({
        body: { email: emailReset, password: 'senha-inicial-12345' },
        asResponse: true,
    })
    ok('senha antiga deixa de entrar', !comAntiga.ok, `HTTP ${comAntiga.status}`)

    // Uso único: o mesmo token não serve duas vezes.
    const reusado = await auth.api.resetPassword({
        body: { newPassword: 'mais-uma-senha-12345', token },
        asResponse: true,
    })
    ok('token é de uso único', !reusado.ok, `HTTP ${reusado.status}`)

    await prisma.user.deleteMany({ where: { email: emailReset } })

    // 9. A credencial criada À MÃO entra de verdade.
    //
    // `api/users/route.ts` cria usuário para outra pessoa, e por isso não pode
    // usar `signUpEmail` — ele emitiria sessão e trocaria a do administrador.
    // Então ele monta a linha e a credencial na mão, com `ctx.password.hash`.
    // Isso só é seguro se o login aceitar o que aquele caminho escreve, e é
    // exatamente o que esta prova confere: criar credencial que não autentica
    // seria um defeito silencioso — o administrador veria "usuário criado" e a
    // pessoa não entraria.
    const { auth: _auth } = await import('@/lib/auth/better-auth')
    const ctx = await _auth.$context
    const senhaAdmin = 'criada-pelo-admin-12345'
    const hash = await ctx.password.hash(senhaAdmin)

    const porAdmin = await prisma.$transaction(async (tx) => {
        const criado = await tx.user.create({
            data: {
                email: `admin-criou-${Date.now()}@odontobox360.test`,
                name: 'Criada pelo Admin',
                emailVerified: true,
            },
        })
        await tx.authAccount.create({
            data: {
                userId: criado.id,
                providerId: 'credential',
                accountId: criado.id,
                password: hash,
            },
        })
        return criado
    })

    const loginAdmin = await auth.api.signInEmail({
        body: { email: porAdmin.email, password: senhaAdmin },
        asResponse: true,
    })
    ok('credencial criada à mão autentica', loginAdmin.ok, `HTTP ${loginAdmin.status}`)

    const loginAdminErrado = await auth.api.signInEmail({
        body: { email: porAdmin.email, password: 'outra-senha-qualquer' },
        asResponse: true,
    })
    ok('e recusa senha errada', !loginAdminErrado.ok, `HTTP ${loginAdminErrado.status}`)

    await prisma.user.delete({ where: { id: porAdmin.id } })

    // 10. O limite de requisições estrangula de verdade, e **em banco**.
    //
    // Achado na auditoria: a biblioteca liga o limite sozinha em produção, mas
    // com `storage: "memory"` — um `new Map()` no módulo. Em Workers cada
    // isolate tem o seu, e eles são muitos e efêmeros, então o limite efetivo
    // seria "N por isolate", que para quem adivinha senha é nenhum. Em banco o
    // contador é um só.
    await prisma.authRateLimit.deleteMany({})

    const alvo = `limite-${Date.now()}@odontobox360.test`
    await auth.api.signUpEmail({
        body: { email: alvo, password: 'senha-do-alvo-12345', name: 'Alvo' },
        asResponse: true,
    })

    /**
     * Pelo `auth.handler`, e **não** por `auth.api.signInEmail`.
     *
     * Descoberto escrevendo este teste: chamar `auth.api.*` direto pula a cadeia
     * HTTP da biblioteca, e o limitador vive nela. Doze tentativas por
     * `auth.api` deram doze 401 e zero linhas no contador — o que parecia um
     * limite que não funciona era um teste que não passava por ele.
     *
     * Importa além do teste: significa que o limite protege o que entra pela
     * rota (`/api/auth/*`, via `toNextJsHandler`), e **não** protege chamadas
     * internas de servidor. Está correto assim — chamada interna já vem de
     * código nosso, autenticado antes —, mas é bom saber antes de alguém expor
     * um endpoint próprio chamando `auth.api` e presumir que está limitado.
     */
    const pedirLogin = (senha: string) =>
        auth.handler(
            new Request('http://localhost:3000/api/auth/sign-in/email', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    // O limitador chaveia por IP; sem isto todas as tentativas
                    // caem no mesmo bucket "desconhecido", que é o que se quer
                    // aqui, mas melhor ser explícito.
                    'x-forwarded-for': '203.0.113.7',
                },
                body: JSON.stringify({ email: alvo, password: senha }),
            })
        )

    // `/sign-in/email` admite 10 por minuto. A décima primeira tem de ser 429.
    let estatus = 0
    for (let i = 0; i < 12; i++) {
        const r = await pedirLogin(`errada-${i}`)
        estatus = r.status
        if (r.status === 429) break
    }
    ok('tentativas repetidas de login são estranguladas', estatus === 429, `parou em HTTP ${estatus}`)

    const contadores = await prisma.authRateLimit.count()
    ok('o contador vive no BANCO, não em memória', contadores > 0, `${contadores} linha(s)`)

    const linha = await prisma.authRateLimit.findFirst({ select: { key: true, count: true } })
    ok('a chave identifica rota e origem', (linha?.key?.length ?? 0) > 0, linha?.key)
    ok('o contador passou do limite da regra', (linha?.count ?? 0) >= 10, `count=${linha?.count}`)

    await prisma.user.deleteMany({ where: { email: alvo } })
    await prisma.authRateLimit.deleteMany({})

    // Limpeza. CASCADE leva sessões e credenciais junto — conferir que leva.
    await prisma.user.delete({ where: { id: usuario!.id } })
    ok(
        'CASCADE apaga sessões e credenciais',
        (await prisma.authSession.count({ where: { userId: usuario!.id } })) === 0 &&
            (await prisma.authAccount.count({ where: { userId: usuario!.id } })) === 0
    )
    await prisma.user.deleteMany({ where: { email: { endsWith: '@odontobox360.test' } } })

    console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`)
    await prisma.$disconnect()
    process.exit(falhas === 0 ? 0 : 1)
}

void main()
