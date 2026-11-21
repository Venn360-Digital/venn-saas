import prisma from '@venn/db/cliente'

/**
 * Marca como `expirada` a proposta cujo prazo venceu.
 *
 * ## Por que isto precisa existir
 *
 * Sem esta rotina, o estado `expirada` da máquina em `lib/propostas/estados.ts`
 * nunca aconteceria: `enviada` ficaria `enviada` para sempre. A rota pública já
 * recusa o aceite fora do prazo — então não há risco de alguém aceitar o que
 * venceu —, mas a **lista** mostraria dezenas de propostas "enviadas" de meses
 * atrás, e o filtro por situação deixaria de servir para ver o que está de pé.
 *
 * É também o que faz "taxa de aceite" ser calculável no PR de relatórios:
 * enviadas que venceram sem resposta são o denominador, e sem carimbá-las não há
 * como separá-las das que ainda estão em jogo.
 *
 * ## Só expira o que TEM prazo
 *
 * `validUntil` é nulo quando o vendedor não pôs prazo, e nesse caso a proposta
 * não expira — de propósito. Inventar um prazo padrão aqui faria propostas
 * perfeitamente vivas virarem expiradas por uma decisão que ninguém tomou.
 *
 * Quem **sempre** tem prazo é o link (`ProposalShare.expiresAt` é obrigatório),
 * e ele para de abrir por conta própria. São dois conceitos, e este trata do
 * primeiro.
 *
 * ## Por que `updateMany` e não um laço
 *
 * É uma instrução só, e o volume é de dezenas por unidade. Um laço daria o
 * mesmo resultado com N idas ao banco — e esta rotina roda em todas as
 * unidades, de madrugada, quando o compute do Neon deveria estar suspenso.
 */
export async function runPropostasExpiradas(): Promise<void> {
    const agora = new Date()

    const resultado = await prisma.proposalRevision.updateMany({
        where: {
            status: 'enviada',
            validUntil: { not: null, lt: agora },
        },
        data: { status: 'expirada' },
    })

    if (resultado.count > 0) {
        console.log(`[cron:propostas-expiradas] ${resultado.count} revisão(ões) marcada(s) como expirada`)
    }
}
