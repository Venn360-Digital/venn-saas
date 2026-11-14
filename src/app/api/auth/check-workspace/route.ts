import { NextResponse } from 'next/server'
import { currentMembership } from '@/lib/auth/workspace'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import prisma from '@venn/db/cliente'
import { daContaDaUnidade } from '@/lib/account'

/**
 * Quando passou a existir um lugar onde gravar o aceite.
 *
 * A tabela `terms_acceptances` nasceu na migração
 * `20261007120000_trial_and_credit_rules`. Workspace criado antes disso **não
 * pode** ter aceite — não havia coluna. Tratar essa ausência como "cadastro
 * inacabado" manda uma clínica que já opera de volta ao onboarding, e não colhe
 * aceite nenhum: faz repetir um cadastro terminado, com um passo de QR que pode
 * desparear o número em uso.
 *
 * Não é uma suposição de que aquela clínica aceitou. É o reconhecimento de que
 * o portão não pode valer para trás. O aceite dessas contas se recolhe dentro do
 * produto, não reempurrando o cadastro.
 */
const TERMS_RECORDED_SINCE = new Date('2026-10-07T12:00:00Z')

export async function GET() {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return NextResponse.json({ hasWorkspace: false }, { status: 401 })
        }

        // Use Prisma to check workspace (bypasses RLS)
        const workspaceUser = await currentMembership()
        const workspace = workspaceUser
            ? await prisma.workspace.findUnique({
                where: { id: workspaceUser.workspaceId },
                select: { createdAt: true },
            })
            : null

        /**
         * "Tem workspace" passou a significar "terminou o cadastro".
         *
         * O pareamento do WhatsApp acontece no passo 3, antes do aceite, e para
         * isso o workspace precisa existir antes do fim. Sem esta checagem,
         * quem abandonasse no passo 4 entraria direto no painel na próxima
         * visita e nunca veria os termos — o aceite deixaria de existir para
         * aquela clínica. Com ela, o cadastro inacabado volta ao onboarding.
         */
        /**
         * O aceite é **da conta**, não da pessoa — e era esse o defeito.
         *
         * A consulta filtrava por `userId`. Quem o dono cadastra em
         * Gerenciamento → Usuários tem linha de participação e **nenhum**
         * aceite próprio, porque nunca passou por cadastro: para essa pessoa
         * isto respondia `hasWorkspace: false` e o login dela caía no
         * onboarding — tela que lhe pede para criar um workspace que já existe,
         * escolher um plano que não é dela e aceitar um termo que não é dela.
         *
         * O termo é do contrato: quem assina é o MASTER, uma vez, e isso vale
         * para a conta inteira — "não é um termo de consentimento", nas palavras
         * do Andre. Então a procura é por aceite em **qualquer unidade da
         * conta**, de quem quer que seja.
         *
         * Na prática o aceite que isto encontra é sempre o do dono: é o único
         * caminho que grava a tabela. Mas o filtro é por conta e não por dono de
         * propósito — na Multiclínica, "o dono" de qual unidade não tem resposta
         * boa, e `Account.ownerUserId` é anulável.
         */
        const accepted = workspaceUser
            ? await prisma.termsAcceptance.findFirst({
                  where: daContaDaUnidade(workspaceUser.workspaceId),
                  orderBy: { acceptedAt: 'desc' },
                  select: { id: true, version: true, acceptedAt: true, userId: true },
              })
            : null

        /**
         * E o convidado não passa pelo cadastro **nem quando o aceite falta**.
         *
         * Dois portões em vez de um porque eles respondem a perguntas
         * diferentes. O de cima é "esta conta aceitou o termo?". Este é "esta
         * pessoa é quem cadastra?" — e um ATENDENTE nunca é, mesmo numa conta
         * anterior ao portão, cujo aceite está pendente. Sem isto, a conta
         * grandfathered teria o dono entrando no painel com o aviso de aceite
         * pendente e os convidados dela presos no onboarding.
         */
        const convidado = Boolean(workspaceUser && workspaceUser.role !== 'OWNER')

        // Conta anterior ao portão: entra no painel, e o aceite fica pendente
        // para ser pedido lá dentro.
        const grandfathered = Boolean(
            workspace && workspace.createdAt < TERMS_RECORDED_SINCE
        )

        return NextResponse.json({
            hasWorkspace: Boolean(workspaceUser && (accepted || grandfathered || convidado)),
            // O workspace provisório, para quem está no meio do cadastro.
            workspaceId: workspaceUser?.workspaceId || null,
            acceptedTerms: Boolean(accepted),
            // Qual versão, e quando — é o que a tela de Plano mostra de volta
            // depois do aceite. Um aceite sem data não é registro de nada.
            acceptedVersion: accepted?.version ?? null,
            acceptedAt: accepted?.acceptedAt ?? null,
            /**
             * Tem workspace e entra, mas o aceite da conta ainda não existe.
             *
             * Só para quem pode aceitar: pedir o termo a um convidado seria
             * pedir assinatura de contrato a quem não contratou.
             */
            termsPending: Boolean(workspaceUser && !accepted && grandfathered && !convidado),
        })
    } catch (error) {
        console.error('[CHECK_WORKSPACE] Error:', error)
        return NextResponse.json({ hasWorkspace: false }, { status: 500 })
    }
}
