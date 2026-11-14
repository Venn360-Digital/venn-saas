import type { Metadata } from 'next'
import prisma from '@venn/db/cliente'
import { lerTokenDeDescadastro } from '@venn/core/lib/marketing/descadastro'
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
 * ## Assinatura que não confere diz que não confere
 *
 * Esta tela nasceu mostrando "Inscrição cancelada" para **qualquer** token,
 * inclusive os quebrados, para não virar oráculo de ids válidos. Esse
 * raciocínio não se sustenta: a página de sucesso é inalcançável sem o segredo
 * do servidor, então o ramo "assinatura inválida" só é visto por quem não
 * consegue forjar, e o que ele aprende é um fato sobre a própria entrada dele.
 *
 * O custo do silêncio, em contrapartida, é alto e frequente. Cliente de e-mail
 * quebra URL longa em duas linhas, e o link chega pela metade. Com a página
 * antiga a pessoa lia "cancelada", parava de tentar, continuava recebendo e
 * marcava como spam — a reclamação que queima a reputação do domínio do
 * cliente, que é o que este link inteiro existe para evitar. Pela RFC 8058 é
 * pior ainda: o botão nativo faz POST, e um token quebrado "daria certo" sem
 * ninguém ver.
 *
 * ## O que continua indistinguível, e aí sim de propósito
 *
 * **Assinatura boa que não gravou nada** — contato apagado depois do envio,
 * token de outra unidade, ou quem já havia saído — mostra a página de sucesso.
 * É neste ramo que o oráculo moraria de verdade: quem tem um token válido
 * poderia descobrir se aquele contato ainda existe. E, para a pessoa, o
 * desfecho é o mesmo: ela não vai receber.
 *
 * A tela também **não mostra o nome nem o e-mail** da pessoa: a URL pode ser
 * compartilhada, e a página não precisa confirmar quem é para fazer o serviço.
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

    if (!alvo) {
        return (
            <Aviso titulo="Este link não funcionou">
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    O endereço está incompleto ou foi alterado, então <strong>nada foi
                    cancelado</strong>. Alguns programas de e-mail cortam links longos ao
                    quebrar a linha: abra a mensagem original e clique no link de novo, sem
                    copiar e colar.
                </p>
                <p className="mt-6 text-xs text-muted-foreground">
                    Se continuar sem funcionar, responda àquela mensagem pedindo para ser
                    removido da lista — quem te enviou consegue fazer isso.
                </p>
            </Aviso>
        )
    }

    /**
     * `updateMany`, não `update`: o id vem de fora.
     *
     * `update` lança quando não acha a linha, e aqui "não achou" é normal —
     * contato apagado depois do envio, ou token de outra unidade. O `updateMany`
     * não acha, não grava e não reclama, e é por isso que este ramo mostra
     * sucesso mesmo sem ter gravado (ver o cabeçalho).
     *
     * O `where` leva o `workspaceId` **assinado**, não o id sozinho: é o que
     * impede um token válido de uma unidade de mexer no contato de outra.
     */
    await prisma.contact.updateMany({
        where: {
            id: alvo.contactId,
            workspaceId: alvo.workspaceId,
            // Só grava quem ainda não saiu — repetir o clique não reescreve a
            // data, e a data de quando a pessoa pediu é o que importa.
            emailOptOutAt: null,
        },
        data: { emailOptOutAt: new Date() },
    })

    return (
        <Aviso titulo="Inscrição cancelada">
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Você não vai mais receber e-mails de divulgação deste contato. Mensagens
                sobre atendimentos e agendamentos que você já tenha em andamento continuam
                chegando.
            </p>
            <p className="mt-6 text-xs text-muted-foreground">
                Mudou de ideia? Fale com quem te atende e peça para voltar à lista.
            </p>
        </Aviso>
    )
}

/**
 * A casca das duas respostas.
 *
 * As duas páginas são iguais por fora de propósito: quem chega aqui chegou de
 * um e-mail, não do sistema, e não tem por que reconhecer um layout. O que
 * muda é só o que está escrito — e é o texto que decide se a pessoa vai tentar
 * de novo ou desistir achando que resolveu.
 */
function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
    return (
        <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-16">
            <div className="w-full max-w-md rounded-xl border border-border/60 bg-card p-8 text-center shadow-sm">
                <h1 className="text-xl font-semibold text-foreground">{titulo}</h1>
                {children}
                <p className="mt-8 text-xs text-muted-foreground/70">
                    Enviado por {BRAND.name}
                </p>
            </div>
        </main>
    )
}
