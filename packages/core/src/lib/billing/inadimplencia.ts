/**
 * A carência: quanto tempo a clínica tem depois do vencimento.
 *
 * **Decisão do Andre, 2026-10-18: 3 dias no cartão, 2 no Pix.** A diferença não
 * é arbitrária — o Pix confirma em segundos, então dois dias já cobrem o fim de
 * semana de quem esqueceu; o cartão recusado precisa de mais, porque a solução
 * depende do banco do cliente (limite, antifraude, cartão trocado) e isso não
 * se resolve no mesmo dia.
 *
 * Pura e sem banco, para a conta ser conferível em `npm run check:period` — é
 * ela que decide o dia em que uma clínica para de atender, e esse é o tipo de
 * número que não pode errar calado.
 *
 * O QUE A CARÊNCIA **NÃO** FAZ
 *
 * Não desliga o WhatsApp e não apaga nada. O fim dela leva ao mesmo estado de
 * somente-leitura que a avaliação vencida já produz (PRODUCT.md §3): mensagens
 * continuam chegando e o histórico inteiro continua legível; o que para é
 * enviar e criar. Pagar restaura na hora.
 */

/** Quantos dias de carência depois do vencimento, pelo meio de pagamento. */
export function carenciaEmDias(billingType: string | null | undefined): number {
    return billingType === 'PIX' ? 2 : 3
}

/**
 * Quando a carência termina, a partir do vencimento da cobrança.
 *
 * A hora é **23:59:59 de São Paulo** do último dia, e não o instante exato do
 * vencimento mais N × 24h: a clínica lê "você tem até dia 21" e paga no dia 21,
 * à tarde. Cortar às 9h da manhã do dia 21 porque a cobrança venceu às 9h do
 * dia 18 seria cumprir a letra e quebrar a promessa.
 */
export function fimDaCarencia(dueDate: Date, billingType: string | null | undefined): Date {
    const dias = carenciaEmDias(billingType)

    /**
     * A conta anda em **dias de calendário**, não em múltiplos de 86.400.000
     * somados ao instante do vencimento.
     *
     * A cobrança vence numa data (o Asaas manda "2026-11-18", sem hora), e a
     * clínica lê "você tem até dia 21". Somar 3 × 24h ao instante gravado
     * cortaria no meio do dia 21 — cumprindo a letra e quebrando a promessa.
     *
     * **O dia é lido em UTC, não em São Paulo**, e isso é medido, não
     * preferência: o espelho grava o vencimento ao meio-dia de São Paulo
     * (15:00Z) e as linhas antigas o gravaram à meia-noite UTC. Nos dois casos
     * o dia do calendário UTC é o dia certo; ler em São Paulo transformaria a
     * meia-noite UTC no dia anterior e daria **um dia a menos** de carência —
     * sempre para o lado de cortar antes.
     *
     * O `-03:00` do retorno é literal porque o Brasil não tem horário de verão
     * desde 2019, e é a mesma convenção que o resto do projeto usa ao
     * reconstruir datas do gateway.
     */
    const fim = new Date(
        Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate())
    )
    fim.setUTCDate(fim.getUTCDate() + dias)

    return new Date(`${fim.toISOString().slice(0, 10)}T23:59:59.999-03:00`)
}

/** Se a carência já venceu — o corte pode acontecer. */
export function carenciaVencida(graceEndsAt: Date | null | undefined, agora: Date): boolean {
    return Boolean(graceEndsAt && graceEndsAt.getTime() <= agora.getTime())
}
