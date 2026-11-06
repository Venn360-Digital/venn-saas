/**
 * O convite: validade, estado e o que cada estado permite.
 *
 * Puro de propósito — é aqui que moram as decisões que erram calado, e todas
 * elas se exercitam sem banco e sem relógio real (o "agora" é parâmetro).
 *
 * ## Por que o estado é DERIVADO e não uma coluna
 *
 * O pedido lista "estado" entre os campos da tabela. Guardá-lo seria o defeito:
 * um convite gravado como `pendente` **vira expirado sozinho** quando o relógio
 * passa de `expiresAt`, e nada escreve na linha nesse instante. A coluna
 * mentiria até alguém tocá-la — e a tela mostraria "pendente" num convite que a
 * rota de aceite já recusa.
 *
 * Então o estado sai de três instantes (`acceptedAt`, `revokedAt`,
 * `expiresAt`), que são fatos, e a ordem de precedência entre eles é a regra.
 */

export const VALIDADE_EM_DIAS = 7

export type EstadoDoConvite = 'pendente' | 'aceito' | 'revogado' | 'expirado'

export interface ConviteParaEstado {
    expiresAt: Date
    acceptedAt: Date | null
    revokedAt: Date | null
}

/**
 * O estado, pela ordem que importa.
 *
 * **Aceito vence tudo**, inclusive revogado e expirado: se a pessoa já entrou,
 * ela já é da equipe, e o convite é só o registro histórico de como ela chegou.
 * Revogar depois do aceite não a desliga — para isso existe o `isActive` do
 * membro, que é outro gesto, com outra tela.
 *
 * **Revogado vence expirado** porque é ato de gente: quem revogou quer ver
 * "revogado" na lista, não "expirou sozinho".
 */
export function estadoDoConvite(convite: ConviteParaEstado, agora: Date): EstadoDoConvite {
    if (convite.acceptedAt) return 'aceito'
    if (convite.revokedAt) return 'revogado'
    if (convite.expiresAt.getTime() <= agora.getTime()) return 'expirado'
    return 'pendente'
}

/** Só convite pendente abre a tela de definir senha. */
export function podeAceitar(convite: ConviteParaEstado, agora: Date): boolean {
    return estadoDoConvite(convite, agora) === 'pendente'
}

/**
 * Reenviar: só o que ainda não foi usado.
 *
 * Expirado **pode** ser reenviado — é o caso comum, alguém demorou — e o
 * reenvio estende a validade em vez de criar outra linha, para a lista não
 * encher de convites iguais para a mesma pessoa. Revogado não: revogar é dizer
 * "não quero mais", e reenviar seria desfazer sem dizer. Para voltar atrás,
 * convida de novo.
 */
export function podeReenviar(convite: ConviteParaEstado, agora: Date): boolean {
    const estado = estadoDoConvite(convite, agora)
    return estado === 'pendente' || estado === 'expirado'
}

/** Revogar: só o que ainda não foi aceito. Revogar o aceito não desliga ninguém. */
export function podeRevogar(convite: ConviteParaEstado, agora: Date): boolean {
    const estado = estadoDoConvite(convite, agora)
    return estado === 'pendente' || estado === 'expirado'
}

/** O vencimento de um convite criado ou reenviado agora. */
export function vencimentoDe(agora: Date, dias = VALIDADE_EM_DIAS): Date {
    return new Date(agora.getTime() + dias * 24 * 60 * 60 * 1000)
}

/** O rótulo de cada estado na tela. Sentence case, sem ponto — §7. */
export const ROTULO_DO_ESTADO: Record<EstadoDoConvite, string> = {
    pendente: 'Aguardando',
    aceito: 'Aceito',
    revogado: 'Revogado',
    expirado: 'Expirado',
}

/**
 * Quantos dias de validade restam, para a lista dizer "expira em 3 dias".
 *
 * Arredonda **para cima**: faltando 30 minutos, a pessoa precisa ler "expira
 * hoje" e não "expira em 0 dias". Zero ou menos é expirado, e aí quem manda é
 * `estadoDoConvite`.
 */
export function diasRestantes(convite: ConviteParaEstado, agora: Date): number {
    const ms = convite.expiresAt.getTime() - agora.getTime()
    return ms <= 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000))
}

/**
 * O e-mail, na forma que a comparação precisa.
 *
 * Minúscula e sem espaço nas pontas, porque convite é casado com o endereço
 * digitado por **duas** pessoas diferentes — quem convida e quem aceita — e
 * "Ana@Clinica.com " não pode virar um segundo convite.
 */
export function normalizarEmail(email: string): string {
    return email.trim().toLowerCase()
}
