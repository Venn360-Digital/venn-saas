import { podeTransicionar, type EstadoDaRevisao } from './estados'

/**
 * Quem pode pedir aprovação, e quem pode dar — a alçada do documento.
 *
 * ## Por que existe agora
 *
 * `em_aprovacao`, `aprovada` e `reprovada` nasceram no domínio em 21/11/2026 e
 * **sem tela**: o plano dizia "só quando alguém pedir", e o caminho normal era
 * `rascunho → enviada`. A homologação pediu. O que faltava não era a máquina de
 * estado — ela já tinha as transições e o verificador já as provava — era quem
 * tem permissão para cada lado dela.
 *
 * ## A assimetria é o ponto
 *
 * **Pedir** aprovação é trabalho de quem monta o documento: um atendente pede.
 * **Dar** é alçada, e alçada é papel de gestão (`OVERSIGHT_ROLES`). Se os dois
 * lados fossem o mesmo papel, a aprovação não aprovaria nada — quem quer o
 * desconto se aprovaria, e o estado existiria só para dar trabalho.
 *
 * E a recíproca, que é o descuido fácil: quem aprova **não** pode ser quem
 * pediu. Ver `ehAutoAprovacao`.
 *
 * ## Por que módulo próprio, puro
 *
 * A decisão não toca banco: é `(estado, papel, quem pediu, quem decide)` →
 * permitido ou não. Separada, ela se prova sem Prisma — e é o que permite ao
 * verificador cobrir as oito combinações que importam em vez de uma.
 */

/** O que se pede a esta rota. Não é o estado final: é o gesto. */
export const GESTOS = ['pedir', 'aprovar', 'reprovar', 'cancelar'] as const
export type Gesto = (typeof GESTOS)[number]

/** Para onde cada gesto leva a revisão. */
export const ESTADO_DO_GESTO: Record<Gesto, EstadoDaRevisao> = {
    pedir: 'em_aprovacao',
    aprovar: 'aprovada',
    reprovar: 'reprovada',
    /** Desfaz o próprio pedido e devolve a revisão para edição. */
    cancelar: 'rascunho',
}

/** Rótulo do gesto, para a tela e para a notificação. */
export const ROTULO_DO_GESTO: Record<Gesto, string> = {
    pedir: 'Enviar para aprovação',
    aprovar: 'Aprovar',
    reprovar: 'Reprovar',
    cancelar: 'Cancelar o pedido',
}

export function ehGesto(valor: string): valor is Gesto {
    return (GESTOS as readonly string[]).includes(valor)
}

/**
 * Decidir é alçada; pedir não é.
 *
 * `OVERSIGHT_ROLES` é a lista que o produto já usa para "quem supervisiona" —
 * a mesma dos relatórios. Reusada em vez de uma lista nova, porque duas listas
 * de papel divergem, e divergem caladas.
 */
export function gestoEhDeAlcada(gesto: Gesto): boolean {
    return gesto === 'aprovar' || gesto === 'reprovar'
}

/**
 * Quem pode cancelar um pedido de aprovação: **quem pediu, ou a gestão.**
 *
 * Quem pediu, porque desfazer o próprio pedido é retirar uma solicitação, não
 * decidir sobre ela — não há registro de aprovação sendo forjado. É o que tira
 * do beco a unidade onde a única pessoa com alçada é quem pediu.
 *
 * A gestão, porque alguém precisa poder destravar o pedido de quem saiu de
 * férias sem reprovar o documento — reprovar carimba a revisão de vermelho, e
 * destravar não devia exigir isso.
 */
export function podeCancelar(quemPediu: string | null, quemAge: string, temAlcada: boolean): boolean {
    return temAlcada || (quemPediu !== null && quemPediu === quemAge)
}

/**
 * Quem pediu não decide.
 *
 * Sem isto, a alçada vira teatro para quem tem papel de gestão: o gestor que
 * monta a própria proposta com desconto fora da política pede e aprova no mesmo
 * clique, e o registro diz que houve aprovação.
 *
 * `quemPediu` nulo é "ninguém pediu ainda" — não bloqueia, porque não há de quem
 * suspeitar.
 */
export function ehAutoAprovacao(gesto: Gesto, quemPediu: string | null, quemDecide: string): boolean {
    if (!gestoEhDeAlcada(gesto)) return false
    return quemPediu !== null && quemPediu === quemDecide
}

export type Veredito = { ok: true; para: EstadoDaRevisao } | { ok: false; motivo: string; status: number }

/**
 * A decisão inteira, numa função.
 *
 * Devolve o estado de destino ou o motivo da recusa **com o código HTTP**, para
 * que a rota não escolha o código — e os dois não divirjam quando um terceiro
 * gesto entrar.
 */
export function avaliarGesto(entrada: {
    gesto: Gesto
    estadoAtual: string
    temAlcada: boolean
    quemPediu: string | null
    quemDecide: string
}): Veredito {
    const para = ESTADO_DO_GESTO[entrada.gesto]

    if (gestoEhDeAlcada(entrada.gesto) && !entrada.temAlcada) {
        return {
            ok: false,
            status: 403,
            motivo: 'Aprovar ou reprovar é da gestão da unidade.',
        }
    }

    if (
        entrada.gesto === 'cancelar' &&
        !podeCancelar(entrada.quemPediu, entrada.quemDecide, entrada.temAlcada)
    ) {
        return {
            ok: false,
            status: 403,
            motivo: 'Só quem pediu a aprovação, ou a gestão, pode cancelar o pedido.',
        }
    }

    if (ehAutoAprovacao(entrada.gesto, entrada.quemPediu, entrada.quemDecide)) {
        return {
            ok: false,
            status: 403,
            motivo: 'Quem pediu a aprovação não pode decidi-la. Peça a outra pessoa da gestão.',
        }
    }

    /**
     * A máquina de estado tem a última palavra.
     *
     * Depois dos papéis, e não antes: "você não pode" e "daqui não dá" são
     * respostas diferentes, e trocá-las faria o atendente achar que é permissão
     * quando é estado — ou o contrário.
     */
    if (!podeTransicionar(entrada.estadoAtual, para)) {
        return {
            ok: false,
            status: 409,
            motivo: `Não é possível ${entrada.gesto} um documento neste estado.`,
        }
    }

    return { ok: true, para }
}
