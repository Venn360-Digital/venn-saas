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

import { BRAND } from '../../marca'
import { renderEmail } from './layout'
import { VALIDADE_EM_DIAS } from '../convite/estado'

export const TEMPLATES = {
    /**
     * O convite de quem foi cadastrado por um administrador.
     *
     * ## O texto tem de descrever o fluxo que existe, e agora existe
     *
     * Este e-mail já esteve errado nas duas direções, e o histórico vale para
     * não repetir nenhuma delas.
     *
     * **Primeiro ele prometeu o que não havia:** dizia "no primeiro acesso você
     * escolhe a sua senha" e "vale por 30 dias", com um link sem token que ia
     * para a tela de entrada. Quem recebesse clicaria, cairia no login sem
     * senha para digitar, e ligaria para quem o cadastrou.
     *
     * **Então ele desceu ao que o sistema fazia:** passou a mandar pedir a
     * senha a quem convidou. Feio, e verdadeiro — o oposto do reflexo de
     * "melhorar o texto".
     *
     * **Agora a feature existe**, e o texto sobe de volta: tabela de convites,
     * token de uso único em resumo, validade real e tela de definir senha. A
     * frase sobre escolher a senha voltou porque virou verdade, não porque é
     * mais bonita — e `VALIDADE_EM_DIAS` vem do módulo que a decide, para o
     * e-mail não poder divergir dela.
     */
    inviteMember: (inviteUrl: string, unidade?: string) =>
        renderEmail({
            headline: 'Você foi convidado',
            body: [
                unidade
                    ? `A ${BRAND().vocabulario.organizacao} <strong style="color:#0b1f3b;">${unidade}</strong> convidou você para atender pelo ${BRAND().name}.`
                    : `Você foi convidado para atender pelo ${BRAND().name}.`,
                'Clique abaixo para <strong style="color:#0b1f3b;">escolher a sua senha</strong>. Ninguém define senha para você — nem quem te convidou.',
                `O link vale por ${VALIDADE_EM_DIAS} dias e serve uma vez só. Depois de escolher a senha, você entra normalmente.`,
            ],
            cta: { texto: 'Escolher minha senha', url: inviteUrl },
            ilustracao: 'conversa',
            porque: `Você recebe este e-mail porque alguém da ${BRAND().vocabulario.organizacao} convidou o seu endereço para o ${BRAND().name}. Se não era você, ignore — sem a senha, o convite não vira acesso.`,
            tone: 'neutral',
        }),
}
