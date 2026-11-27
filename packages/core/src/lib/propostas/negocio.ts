import 'server-only'

import type { Prisma } from '@venn/db'

import { normalizePhone } from '../phone'
import { negocioAbertoNoFunil } from '../pipeline/funis'
import { phoneVariants } from '../whatsapp/types'

/**
 * O negócio que nasce junto com a proposta — e o cliente junto com ele.
 *
 * ## Por que existe
 *
 * Na homologação de 21/11/2026 o dono do produto apontou o que faltava: a tela
 * de nova proposta **exigia** escolher um negócio já existente, e quem acabou de
 * receber um pedido não tem nenhum. O caminho era sair da tela, criar o cliente,
 * criar o negócio e voltar — três telas para começar um orçamento.
 *
 * E a observação que fecha o desenho: *"o cliente deve nascer na criação do
 * negócio"*. Negócio sem ficha não serve para nada aqui — a proposta precisa do
 * nome para o documento, e o envio precisa do telefone ou do e-mail.
 *
 * ## Por que numa transação, e não em três chamadas da tela
 *
 * A tela poderia chamar `POST /api/contacts`, depois `POST /api/deals`, depois
 * `POST /api/propostas`. Cada uma com sua falha: a segunda falhando deixa uma
 * ficha órfã que ninguém pediu, e a terceira falhando deixa um negócio vazio no
 * funil. Numa transação só, ou nasce tudo ou não nasce nada.
 *
 * ## O que esta função NÃO faz
 *
 * Não contorna a regra 1:1 por funil (`negocioAbertoNoFunil`): se a ficha já tem
 * negócio aberto no funil padrão, ela **devolve o negócio existente** em vez de
 * criar um segundo, e quem chama decide o que dizer. Criar o segundo faria o
 * mesmo cliente aparecer duas vezes no quadro, e é exatamente o que aquela regra
 * existe para impedir.
 */

/** O cliente digitado na tela. O nome é obrigatório; um dos dois contatos também. */
export interface ClienteNovo {
    nome: string
    telefone?: string | null
    email?: string | null
}

export type NegocioResolvido =
    | {
          ok: true
          dealId: string
          /** O que de fato nasceu — é o que a tela usa para dizer o que fez. */
          criou: { contato: boolean; negocio: boolean }
      }
    | { ok: false; motivo: string }

/**
 * O título do negócio quando ninguém digitou um.
 *
 * O nome do cliente, e não "Novo negócio": no quadro do funil o cartão é lido
 * pelo título, e vinte cartões chamados "Novo negócio" não dizem nada. Pura de
 * propósito — é a única decisão aqui que se prova sem banco.
 */
export function tituloDoNegocio(cliente: string, titulo?: string | null): string {
    const escolhido = (titulo ?? '').trim()
    if (escolhido) return escolhido.slice(0, 200)
    return cliente.trim().slice(0, 200)
}

/**
 * Se há como **alcançar** este cliente depois.
 *
 * Nome sozinho monta o documento e não o entrega. Deixar passar faria a tela de
 * envio abrir sem destino nenhum — e aí o vendedor descobre, três telas adiante,
 * que a ficha que ele criou não serve.
 */
export function clienteAlcancavel(cliente: ClienteNovo): boolean {
    return Boolean((cliente.telefone ?? '').trim() || (cliente.email ?? '').trim())
}

/**
 * Acha ou cria a ficha, acha ou cria o negócio, e devolve o id do negócio.
 *
 * Recebe a transação e a etapa já resolvida — a etapa é leitura e não precisa
 * estar dentro, e `primeiraFaseDoPadrao` usa o cliente global. É a mesma divisão
 * de `proximoNumero`: a função recebe o `tx`, nunca abre um.
 */
export async function negocioParaProposta(
    tx: Prisma.TransactionClient,
    entrada: {
        workspaceId: string
        userId: string
        /** A primeira etapa do funil padrão, de `primeiraFaseDoPadrao`. */
        fase: { id: string; pipelineId: string }
        cliente: ClienteNovo
        titulo?: string | null
        valor?: number | null
    }
): Promise<NegocioResolvido> {
    const { workspaceId, userId, fase, cliente } = entrada

    if (!cliente.nome.trim()) return { ok: false, motivo: 'O nome é obrigatório.' }
    if (!clienteAlcancavel(cliente)) {
        return { ok: false, motivo: 'Informe telefone ou e-mail — sem um dos dois não há como enviar o documento.' }
    }

    /**
     * O telefone é gravado como o WhatsApp endereça: dígitos com o país.
     *
     * A mesma regra de `api/contacts/route.ts`, e pela mesma razão medida lá:
     * máscara não casa com dígito no índice único `(workspaceId, phone)`, então
     * "(31) 99999-0001" e `5531999990001` virariam duas fichas da mesma pessoa.
     */
    const telefone = cliente.telefone?.trim() ? normalizePhone(cliente.telefone).digits : null
    const email = cliente.email?.trim() || null

    // Pelas duas formas do nono dígito: quem já escreveu pelo WhatsApp pode
    // estar cadastrado na outra.
    const existente = telefone
        ? await tx.contact.findFirst({
              where: { workspaceId, phone: { in: phoneVariants(telefone) } },
              select: { id: true },
          })
        : null

    let contatoId = existente?.id ?? null
    let criouContato = false

    if (!contatoId) {
        const ficha = await tx.contact.create({
            data: {
                workspaceId,
                name: cliente.nome.trim(),
                phone: telefone,
                email,
                // Digitado por alguém, nesta tela. A origem comercial fica nula:
                // ninguém detecta origem, alguém informa.
                createdVia: 'manual',
            },
            select: { id: true },
        })
        contatoId = ficha.id
        criouContato = true
    } else if (email) {
        /**
         * A ficha que já existia ganha o e-mail, se não tinha.
         *
         * Só o que falta, nunca o que está lá: sobrescrever o e-mail de uma
         * ficha antiga porque alguém digitou outro aqui apagaria dado que a
         * clínica conferiu. `undefined` é como o Prisma diz "não encoste".
         */
        await tx.contact.updateMany({
            where: { id: contatoId, email: null },
            data: { email },
        })
    }

    /**
     * Negócio aberto neste funil? Então é ele.
     *
     * Devolver o existente em vez de criar o segundo é o que respeita a regra
     * 1:1 por funil em vez de contorná-la por um caminho novo.
     */
    const aberto = await negocioAbertoNoFunil(workspaceId, contatoId, fase.pipelineId)
    if (aberto) {
        return { ok: true, dealId: aberto.id, criou: { contato: criouContato, negocio: false } }
    }

    const negocio = await tx.deal.create({
        data: {
            workspaceId,
            contactId: contatoId,
            userId,
            title: tituloDoNegocio(cliente.nome, entrada.titulo),
            value: entrada.valor ?? null,
            stageId: fase.id,
            status: 'open',
        },
        select: { id: true },
    })

    // O percurso começa aqui. Sem esta entrada o trilho do cartão nasce sem data
    // na etapa em que o negócio já está — e o relatório de funil fica cego para
    // ele. A mesma linha que `POST /api/deals` grava.
    await tx.dealStageEntry.create({
        data: { dealId: negocio.id, stageId: fase.id, userId },
    })

    return { ok: true, dealId: negocio.id, criou: { contato: criouContato, negocio: true } }
}
