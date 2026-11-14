import { BRAND } from '@/config/brand'
import { ROTULO_DO_PAPEL } from '@venn/core/lib/papeis'
import { diasRestantes, estadoDoConvite } from '@venn/core/lib/convite/estado'
import { pareceToken, resumoDoToken } from '@venn/core/lib/convite/token'
import prisma from '@venn/db/cliente'

import { ConviteEncerrado } from './encerrado'
import { ConviteForm } from './form'

export const metadata = { title: `Convite — ${BRAND.name}` }

/**
 * Onde o link do convite chega.
 *
 * ## Server component, e não `fetch` da rota pública
 *
 * A rota `GET /api/convite/[token]` existe e faz exatamente isto — mas chamá-la
 * daqui seria o Worker falando com ele mesmo por HTTP para ler o próprio banco:
 * uma viagem de rede, um `await` a mais antes do primeiro byte, e a chance de a
 * tela aparecer vazia enquanto carrega. Lendo aqui, a página chega pronta.
 *
 * A rota continua valendo: é dela que o `POST` do aceite depende, e é ela que
 * um cliente fora do navegador usaria. As duas leem o mesmo módulo
 * (`lib/convite/estado`), então não há duas definições de "expirado".
 *
 * ## O que esta tela não diz
 *
 * Nada da clínica além do nome, nada de quem convidou além do nome. Token
 * inválido e token expirado terminam na mesma tela com frases diferentes — não
 * há enumeração a fazer contra 256 bits sorteados, mas também não há razão para
 * contar mais do que a pessoa precisa para saber o que fazer agora.
 */
export default async function ConvitePage({
    params,
}: {
    params: Promise<{ token: string }>
}) {
    const { token } = await params

    // Checagem de forma antes do banco: `/convite/undefined` é o que um link
    // truncado produz, e não merece uma consulta.
    const convite = pareceToken(token)
        ? await prisma.invite.findUnique({
              where: { tokenHash: await resumoDoToken(token) },
              select: {
                  email: true,
                  role: true,
                  expiresAt: true,
                  acceptedAt: true,
                  revokedAt: true,
                  workspace: { select: { name: true } },
                  invitedBy: { select: { name: true } },
              },
          })
        : null

    if (!convite) return <ConviteEncerrado estado="invalido" />

    const agora = new Date()
    const estado = estadoDoConvite(convite, agora)
    if (estado !== 'pendente') return <ConviteEncerrado estado={estado} />

    /**
     * A face da tela: pedir senha, ou só confirmar o vínculo.
     *
     * Quem já tem usuário — a pessoa é de outra unidade da conta, ou de outra
     * conta — **não** vê campo de senha: ela já tem uma, e trocá-la aqui seria
     * mexer na credencial dela em outro lugar.
     *
     * Isto é dica para a tela, não contrato: o `POST` decide de novo do lado
     * dele. Um cliente que mandasse senha para um e-mail existente não pode
     * conseguir trocá-la.
     */
    const existente = await prisma.user.findUnique({
        where: { email: convite.email },
        select: { name: true, lastName: true },
    })

    return (
        <ConviteForm
            token={token}
            email={convite.email}
            papel={ROTULO_DO_PAPEL[convite.role as keyof typeof ROTULO_DO_PAPEL] ?? convite.role}
            unidade={convite.workspace.name}
            convidadoPor={convite.invitedBy?.name ?? null}
            diasRestantes={diasRestantes(convite, agora)}
            precisaDeSenha={!existente}
            nome={existente?.name ?? ''}
            sobrenome={existente?.lastName ?? ''}
        />
    )
}
