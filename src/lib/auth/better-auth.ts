import 'server-only'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import prisma from '@/lib/prisma'
import { renderEmail } from '@/lib/email/layout'
import { sendEmail } from '@/lib/email/send'

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
                subject: 'Redefinir sua senha — OdontoBox360',
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
