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
    /**
     * O convite de quem foi cadastrado por um administrador.
     *
     * ## O texto tem de descrever o fluxo que existe
     *
     * Este e-mail dizia "no primeiro acesso você escolhe a sua senha" e "o
     * convite vale por 30 dias", e **as duas frases eram falsas**: quem cria o
     * usuário digita a senha inicial no formulário (`api/users`), o link não
     * leva token nenhum — vai para a tela de entrada — e não há nada que
     * expire. Quem recebesse o convite de verdade clicaria, cairia no login
     * sem senha para digitar, e ligaria para quem o cadastrou.
     *
     * Então o corpo passou a mandar pedir a senha a quem convidou, e a dizer
     * onde trocá-la. É o oposto do reflexo de "melhorar o texto": a descrição
     * desceu ao que o sistema faz, em vez de prometer o que seria mais bonito.
     * Convite com token é outra feature — tabela de convites, validade e tela
     * de definir senha —, e enquanto ela não existir o e-mail não a anuncia.
     */
    inviteMember: (inviteUrl: string, unidade?: string) =>
        renderEmail({
            headline: 'Você foi convidado',
            body: [
                unidade
                    ? `A ${BRAND.vocabulario.organizacao} <strong style="color:#0b1f3b;">${unidade}</strong> convidou você para atender pelo ${BRAND.name}.`
                    : `Você foi convidado para atender pelo ${BRAND.name}.`,
                'Quem fez o convite definiu uma senha inicial para o seu acesso — peça essa senha a essa pessoa.',
                'Depois de entrar, troque a senha no menu do seu nome, em <strong style="color:#0b1f3b;">Perfil</strong>.',
            ],
            cta: { texto: `Entrar no ${BRAND.name}`, url: inviteUrl },
            ilustracao: 'conversa',
            porque: `Você recebe este e-mail porque alguém da ${BRAND.vocabulario.organizacao} cadastrou o seu endereço no ${BRAND.name}.`,
            tone: 'neutral',
        }),
}
