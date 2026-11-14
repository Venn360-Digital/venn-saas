import 'server-only'

import type { Prisma } from '@venn/db'
import { idsMencionados, notaEmTextoSimples, quemPassaAColaborar } from './mencoes'

/**
 * O efeito da menção: quem passa a colaborar, e o recado que avisa.
 *
 * Um gesto — escrever a nota marcando `@colega` — e duas consequências. Elas
 * ficam juntas aqui, e não espalhadas na rota, porque **a segunda sem a
 * primeira é pior que nenhuma das duas**: um recado dizendo "olha essa
 * conversa" com um link que a pessoa não pode abrir é uma porta trancada com
 * convite.
 */

/** Dentro da transação da mensagem, para a colaboração e o recado nascerem com ela. */
type Tx = Prisma.TransactionClient

export interface ResultadoDaMencao {
    /** Quem passou a colaborar agora (já exclui quem colaborava). */
    novosColaboradores: string[]
    /** Quantos recados foram criados. */
    recados: number
    /** Marcados que a regra recusou — para o log, nunca para a tela. */
    recusados: string[]
}

/**
 * Aplica a menção de uma nota interna.
 *
 * Chamada **dentro** da transação que grava a nota. Se a transação voltar
 * atrás, ninguém colabora e nenhum recado existe — e é o que se quer:
 * colaborador sem a nota que o explica é uma linha órfã que a tela não sabe
 * justificar.
 *
 * Nunca lança por marcação inválida: um `@[x](id-que-não-existe)` colado à mão
 * entra em `recusados` e a nota é gravada igual. A nota é o registro; a menção
 * é o efeito, e perder a nota por causa do efeito seria a troca errada.
 */
export async function aplicarMencao(
    tx: Tx,
    entrada: {
        workspaceId: string
        conversationId: string
        messageId: string
        /** O texto cru da nota, com a sintaxe `@[Nome](id)`. */
        texto: string
        autorId: string
        /** O responsável atual da conversa, se há. */
        donoId: string | null
    }
): Promise<ResultadoDaMencao> {
    const marcados = idsMencionados(entrada.texto)
    if (!marcados.length) return { novosColaboradores: [], recados: 0, recusados: [] }

    /**
     * Quem dos marcados é membro **ativo** desta unidade.
     *
     * A consulta é por `userId in` e `workspaceId`, e é ela que fecha a parede
     * da unidade: um id colado de outra clínica simplesmente não volta. Fazer
     * isso com a lista inteira de membros seria carregar a equipe toda para
     * conferir três nomes.
     */
    const membros = await tx.workspaceUser.findMany({
        where: {
            workspaceId: entrada.workspaceId,
            userId: { in: marcados },
            isActive: true,
        },
        select: { userId: true },
    })

    const aChamar = quemPassaAColaborar({
        mencionados: marcados,
        autorId: entrada.autorId,
        donoId: entrada.donoId,
        idsDaUnidade: membros.map((m) => m.userId),
    })

    const recusados = marcados.filter((id) => !aChamar.includes(id))
    if (!aChamar.length) return { novosColaboradores: [], recados: 0, recusados }

    /**
     * Quem já colaborava não é novidade.
     *
     * Medido antes de gravar porque o retorno do `createMany` com
     * `skipDuplicates` diz **quantas**, não **quais** — e é "quais" que decide
     * quem recebe recado. Marcar de novo quem já colabora não deve render um
     * segundo aviso: a pessoa já está na conversa, e o aviso repetido é como se
     * ensina alguém a ignorar aviso.
     */
    const jaColaboram = await tx.conversationCollaborator.findMany({
        where: { conversationId: entrada.conversationId, userId: { in: aChamar } },
        select: { userId: true },
    })
    const jaSet = new Set(jaColaboram.map((c) => c.userId))
    const novos = aChamar.filter((id) => !jaSet.has(id))

    if (novos.length) {
        await tx.conversationCollaborator.createMany({
            data: novos.map((userId) => ({
                conversationId: entrada.conversationId,
                userId,
                addedByUserId: entrada.autorId,
            })),
            // Duas notas marcando a mesma pessoa no mesmo instante não podem
            // derrubar a segunda nota.
            skipDuplicates: true,
        })
    }

    /**
     * O recado, para **todos** os que a regra aceitou — não só os novos.
     *
     * É a diferença entre as duas listas, e ela é de propósito: colaborar é
     * estado (ou você colabora, ou não), e recado é evento ("olha isso agora").
     * Quem já colabora e foi marcado de novo quer ser avisado desta nota; o que
     * ele não precisa é de uma segunda linha na tabela de colaboradores.
     */
    const corpo = notaEmTextoSimples(entrada.texto)
    await tx.teamMessage.createMany({
        data: aChamar.map((toUserId) => ({
            workspaceId: entrada.workspaceId,
            fromUserId: entrada.autorId,
            toUserId,
            body: corpo.slice(0, 2000),
            conversationId: entrada.conversationId,
            messageId: entrada.messageId,
        })),
    })

    return { novosColaboradores: novos, recados: aChamar.length, recusados }
}

/**
 * As conversas em que esta pessoa colabora — o filtro "Que eu colaboro".
 *
 * Devolve o recorte, não a lista: quem monta a consulta é a rota, que precisa
 * combinar isto com aba, busca, etiqueta e etapa.
 */
export function recorteDoQueColaboro(userId: string): Prisma.ConversationWhereInput {
    return { collaborators: { some: { userId } } }
}
