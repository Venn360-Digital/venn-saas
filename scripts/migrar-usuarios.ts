/**
 * Dá a cada usuário existente um caminho de entrada no Better Auth.
 *
 * **Por que não migrar os hashes.** O GoTrue guardava bcrypt; o Better Auth usa
 * scrypt. Converter é impossível — hash não se desconverte — e carregar
 * verificação de bcrypt legado para **três** pessoas seria complexidade
 * permanente por um ganho de um dia. A decisão está em
 * `docs/migration/00-open-decisions.md` §2.4.
 *
 * **Por que link e não senha temporária.** Senha temporária existe em texto puro
 * em algum lugar: no terminal de quem roda isto, no WhatsApp em que ela é
 * enviada, na memória de quem a leu. O link não: ele vale uma hora, serve uma
 * vez, e quem escolhe a senha é a própria pessoa. O que trafega não autentica
 * nada depois de usado.
 *
 * Só toca em quem **não tem** credencial. Rodar duas vezes não reescreve nada —
 * gera um link novo, porque o anterior pode ter expirado.
 *
 *     DATABASE_URL='…' BETTER_AUTH_SECRET='…' NEXT_PUBLIC_APP_URL='…' \
 *       npx tsx --conditions=react-server scripts/migrar-usuarios.ts
 *
 * Acrescente `--aplicar` para valer. Sem ele, só lista quem seria afetado.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import { auth } from '@venn/core/lib/auth/better-auth'
import prisma from '@venn/db/cliente'

const aplicar = process.argv.includes('--aplicar')

async function main() {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '')
    if (!baseUrl) {
        console.error('NEXT_PUBLIC_APP_URL é obrigatória: ela monta o link que a pessoa recebe.')
        process.exit(1)
    }

    /**
     * Quem não tem nenhuma credencial.
     *
     * `authAccounts: { none: {} }` e não "quem tem hashedPassword": a coluna
     * antiga pode estar preenchida, vazia ou nula sem relação com conseguir
     * entrar — era um hash contra o qual nada autenticava. O que define se a
     * pessoa entra hoje é existir linha em `auth_accounts`.
     */
    const semCredencial = await prisma.user.findMany({
        where: { authAccounts: { none: {} } },
        select: { id: true, email: true, name: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
    })

    console.log(`usuários sem credencial: ${semCredencial.length}\n`)

    if (semCredencial.length === 0) {
        console.log('nada a fazer.')
        process.exit(0)
    }

    for (const u of semCredencial) {
        console.log(`  ${u.email}  (${u.name ?? 'sem nome'}, desde ${u.createdAt.toISOString().slice(0, 10)})`)
    }

    if (!aplicar) {
        console.log('\nEnsaio. Acrescente --aplicar para gerar os links.')
        process.exit(0)
    }

    console.log('\n--- links de definição de senha ---')
    console.log('Cada um vale 1 hora e serve uma vez. Entregue pessoalmente.\n')

    let falhas = 0

    for (const u of semCredencial) {
        /**
         * O pedido também tenta enviar e-mail, e pode falhar em silêncio.
         *
         * O gancho `sendResetPassword` roda em segundo plano e não derruba a
         * chamada — ver `src/lib/auth/better-auth.ts`. Por isso o link é lido do
         * banco e impresso aqui: no corte não se deve depender de entrega de
         * e-mail estar funcionando, e com três pessoas entregar à mão é mais
         * rápido do que depurar DNS de remetente.
         */
        await auth.api
            .requestPasswordReset({
                body: { email: u.email, redirectTo: `${baseUrl}/nova-senha` },
                asResponse: true,
            })
            .catch(() => null)

        const verif = await prisma.authVerification.findFirst({
            where: { identifier: { startsWith: 'reset-password:' }, value: u.id },
            orderBy: { createdAt: 'desc' },
            select: { identifier: true, expiresAt: true },
        })

        if (!verif) {
            console.error(`  FALHOU  ${u.email} — nenhum token foi gerado`)
            falhas++
            continue
        }

        const token = verif.identifier.replace('reset-password:', '')
        console.log(`  ${u.email}`)
        console.log(`    ${baseUrl}/nova-senha?token=${token}`)
        console.log(`    expira ${verif.expiresAt.toISOString()}\n`)
    }

    if (falhas > 0) {
        console.error(`${falhas} usuário(s) sem link. Não prossiga com o corte.`)
        process.exit(1)
    }

    console.log('pronto. Nenhuma senha trafegou.')
    await prisma.$disconnect()
}

void main()
