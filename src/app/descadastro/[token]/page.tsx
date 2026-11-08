import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { lerTokenDeDescadastro } from '@/lib/marketing/descadastro'
import { BRAND } from '@/config/brand'

/**
 * O descadastro de e-mail — **público, sem sessão, e de um clique**.
 *
 * ## Por que não pede login
 *
 * Quem clica aqui é um contato da clínica: nunca entrou no sistema e não tem
 * conta. Pedir login seria pedir o impossível, e o que a pessoa faria em
 * seguida é marcar o e-mail como spam — que é exatamente o que este link existe
 * para evitar. Reclamação de spam é a métrica que derruba a reputação do
 * domínio do cliente.
 *
 * A identidade vem do token assinado (HMAC, ver `lib/marketing/descadastro.ts`):
 * sem o segredo do servidor ninguém forja um, e trocar um caractere do id
 * invalida a assinatura.
 *
 * ## Por que grava no GET, contra o costume
 *
 * Gravar em GET é errado por padrão — um prefetch do navegador ou um antivírus
 * que abre links dispararia a ação. Aqui é o oposto: a RFC 8058 (`List-Unsubscribe-Post`)
 * **exige** que o descadastro funcione sem interação, e o Gmail e o Outlook
 * chamam este endereço pelo botão nativo deles. Um formulário de confirmação
 * faria o botão nativo falhar em silêncio, e a pessoa continuaria recebendo.
 *
 * O risco é aceitável porque a ação é **estreita e reversível**: ela só grava
 * `emailOptOutAt` num contato, não apaga nada, e a clínica reverte na ficha. Um
 * prefetch indevido custa um e-mail de marketing a menos.
 *
 * ## Por que o opt-out é por unidade
 *
 * O token carrega `workspaceId` **e** `contactId`, e os dois são assinados: o
 * mesmo paciente pode ser contato de duas unidades da mesma rede, e sair da
 * newsletter de uma não é sair da outra.
 *
 * ## O que esta tela nunca faz
 *
 * **Não diz se o token é inválido.** Token ruim mostra a mesma página de
 * sempre. Dizer "token inválido" transformaria a rota num oráculo para
 * descobrir ids válidos por tentativa — e, pior, exporia que aquele endereço
 * está cadastrado. Também **não mostra o nome nem o e-mail** da pessoa: a URL
 * pode ser compartilhada, e a página não precisa confirmar quem é para fazer o
 * serviço.
 */

export const metadata: Metadata = {
    title: 'Cancelar inscrição',
    // Página de ação com dado de contato atrás: não entra em índice de busca.
    robots: { index: false, follow: false },
}

/** `force-dynamic`: grava a cada visita, então não pode ser servida de cache. */
export const dynamic = 'force-dynamic'

export default async function DescadastroPage({
    params,
}: {
    params: Promise<{ token: string }>
}) {
    const { token } = await params
    const alvo = await lerTokenDeDescadastro(token)

    if (alvo) {
        /**
         * `updateMany`, não `update`: o id vem de fora.
         *
         * `update` lança quando não acha a linha, e aqui "não achou" é normal —
         * contato apagado depois do envio, ou token de outra unidade. O
         * `updateMany` não acha, não grava e não reclama.
         *
         * O `where` leva o `workspaceId` **assinado**, não o id sozinho: é o que
         * impede um token válido de uma unidade de mexer no contato de outra.
         */
        await prisma.contact.updateMany({
            where: {
                id: alvo.contactId,
                workspaceId: alvo.workspaceId,
                // Só grava quem ainda não saiu — repetir o clique não reescreve
                // a data, e a data de quando a pessoa pediu é o que importa.
                emailOptOutAt: null,
            },
            data: { emailOptOutAt: new Date() },
        })
    }

    return (
        <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-16">
            <div className="w-full max-w-md rounded-xl border border-border/60 bg-card p-8 text-center shadow-sm">
                <h1 className="text-xl font-semibold text-foreground">Inscrição cancelada</h1>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    Você não vai mais receber e-mails de divulgação deste contato. Mensagens
                    sobre atendimentos e agendamentos que você já tenha em andamento continuam
                    chegando.
                </p>
                <p className="mt-6 text-xs text-muted-foreground">
                    Mudou de ideia? Fale com quem te atende e peça para voltar à lista.
                </p>
                <p className="mt-8 text-xs text-muted-foreground/70">
                    Enviado por {BRAND.name}
                </p>
            </div>
        </main>
    )
}
