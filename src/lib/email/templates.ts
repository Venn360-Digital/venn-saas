/**
 * O convite de equipe — o único e-mail que não é aviso de cobrança.
 *
 * ## O que havia aqui, e por que saiu
 *
 * Este arquivo era `TEMPLATES`, com **doze** funções: redefinição de senha,
 * avaliação, créditos, retenção, cobrança, boas-vindas. Onze delas não tinham
 * chamador — eram uma cópia literal dos textos que `email/billing.ts` também
 * tem, e quem de fato envia é ele, pelos consumidores de fila e pelo webhook do
 * Asaas.
 *
 * Duas cópias do mesmo texto divergem na primeira correção feita só numa. E
 * código morto que ainda compila é pior que código morto: parece vivo.
 *
 * Sobrou o convite, que é do fluxo de usuários e não passa por
 * `notification_logs` — o convite pode e deve ser reenviado.
 */

import { BRAND } from '@/config/brand'
import { renderEmail } from './layout'

export const TEMPLATES = {
    inviteMember: (inviteUrl: string, clinica?: string) =>
        renderEmail({
            headline: 'Você foi convidado',
            body: [
                clinica
                    ? `A ${BRAND.vocabulario.organizacao} <strong style="color:#0b1f3b;">${clinica}</strong> convidou você para atender pelo ${BRAND.name}.`
                    : `Você foi convidado para atender pelo ${BRAND.name}.`,
                'No primeiro acesso você escolhe a sua senha. O convite vale por 30 dias.',
            ],
            cta: { texto: 'Aceitar o convite', url: inviteUrl },
            ilustracao: 'conversa',
            porque: `Você recebe este e-mail porque alguém da ${BRAND.vocabulario.organizacao} cadastrou o seu endereço no ${BRAND.name}.`,
            tone: 'neutral',
        }),
}
