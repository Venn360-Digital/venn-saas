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
import { auth } from '@/lib/auth/better-auth'
import prisma from '@/lib/prisma'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

async function main() {
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
