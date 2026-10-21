import 'server-only'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import prisma from '@/lib/prisma'

/**
 * O Better Auth, montado sobre o schema que já existe.
 *
 * Substitui o Supabase Auth. A diferença que importa não é de API: é que a
 * identidade deixa de ser um serviço externo e passa a ser **tabela no mesmo
 * banco** — o que torna a sessão resolvível pelo Worker sem ida à rede, e torna
 * o usuário juntável com `WorkspaceUser` numa consulta só.
 *
 * **A restrição que manda no desenho: os ids têm de sobreviver.** `User.id` é
 * chave estrangeira em quase todo o schema — `WorkspaceUser`, `Activity`,
 * `Deal`, `Conversation`, `Account.ownerUserId` — e os valores atuais são os
 * UUID que vinham do `auth.users` do Supabase. Gerar id novo seria reescrever o
 * banco inteiro. Então o Better Auth é apontado para a tabela `users` que já
 * existe e **não** gera id: quem gera é o `@default(cuid())` do Prisma, para
 * quem chegar agora, e quem já existe mantém o UUID.
 */
export const auth = betterAuth({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    /**
     * `BETTER_AUTH_SECRET` assina os cookies de sessão.
     *
     * Em produção vem do Cloudflare Secrets. Sem ele a biblioteca recusa subir,
     * que é o comportamento certo — segredo de assinatura com valor padrão é
     * sessão forjável.
     */
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.NEXT_PUBLIC_APP_URL,

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
    session: { modelName: 'AuthSession' },
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
    },
})

export type Sessao = typeof auth.$Infer.Session
