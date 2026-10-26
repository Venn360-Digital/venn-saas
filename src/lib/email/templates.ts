/**
 * Templates visuais dos 8 e-mails transacionais.
 *
 * Cada um segue o padrão: logo → headline → body → CTA → footer
 * Renderizados com renderEmail() do layout.ts
 *
 * Para visualizar: rodar localmente e capturar HTML dos renderEmail() calls
 */

import { renderEmail } from './layout'

export const TEMPLATES = {
  // ── AUTENTICAÇÃO ────────────────────────────────────────────────────────
  resetPassword: (resetUrl: string) =>
    renderEmail({
      headline: 'Redefinir sua senha',
      body: [
        'Alguém — provavelmente você — pediu para trocar a senha desta conta.',
        'O link vale por uma hora e serve uma vez só.',
        'Se não foi você, ignore este e-mail. A senha atual continua valendo e nada muda.',
      ],
      cta: { texto: 'Escolher nova senha', url: resetUrl },
      rodape: 'Se o botão não abrir, copie e cole este endereço no navegador: ' + resetUrl,
    }),

  // ── TRIAL: AVISOS ───────────────────────────────────────────────────────
  trialDay5: (trialEndsAt: Date, plansUrl: string) =>
    renderEmail({
      headline: 'Sua avaliação termina em 2 dias',
      body: [
        `O período gratuito vai até ${formatDate(trialEndsAt)}.`,
        'Escolhendo um plano antes disso, o atendimento continua sem interrupção — seus agentes, conversas e histórico seguem exatamente como estão.',
      ],
      cta: { texto: 'Ver planos', url: plansUrl },
      tone: 'neutral',
    }),

  trialDay6: (trialEndsAt: Date, plansUrl: string) =>
    renderEmail({
      headline: 'Último dia de avaliação',
      body: [
        `A avaliação encerra ${formatDate(trialEndsAt)}.`,
        'Depois disso o sistema continua acessível e as mensagens seguem chegando pelo WhatsApp, mas o envio de respostas fica suspenso até a contratação de um plano.',
        'Nada é apagado, e contratar restabelece tudo na hora.',
      ],
      cta: { texto: 'Escolher um plano', url: plansUrl },
      tone: 'urgent',
    }),

  trialEnded: (plansUrl: string) =>
    renderEmail({
      headline: 'Sua avaliação terminou',
      body: [
        'Seus dados estão todos aqui e as mensagens continuam chegando normalmente pelo WhatsApp — nada foi perdido nem desconectado.',
        'O que está suspenso é o envio de respostas e a criação de novos registros. Assinar um plano restabelece tudo imediatamente.',
        'A exportação dos seus dados continua disponível a qualquer momento.',
      ],
      cta: { texto: 'Assinar um plano', url: plansUrl },
      tone: 'urgent',
    }),

  // ── CRÉDITOS ────────────────────────────────────────────────────────────
  credits80: (used: number, total: number, creditsUrl: string) =>
    renderEmail({
      headline: '80% dos créditos utilizados',
      body: [
        `Você usou ${used.toLocaleString('pt-BR')} dos ${total.toLocaleString('pt-BR')} créditos do período.`,
        'Quando acabarem, o agente para de responder automaticamente e avisa o paciente de que o atendimento continua em instantes. Sua equipe segue respondendo normalmente.',
      ],
      cta: { texto: 'Ver créditos', url: creditsUrl },
      tone: 'neutral',
    }),

  // ── RETENÇÃO ────────────────────────────────────────────────────────────
  retention60: (deleteAt: Date, plansUrl: string) =>
    renderEmail({
      headline: 'Seus dados ainda estão aqui',
      body: [
        `Como a assinatura não foi contratada, os dados deste workspace serão removidos em ${formatDate(deleteAt)}.`,
        'Até lá nada muda: tudo continua acessível para consulta e exportação, e contratar um plano a qualquer momento restabelece o atendimento sem perda nenhuma.',
        'Se preferir levar seus dados, a exportação está disponível nas telas de pacientes e negócios.',
      ],
      cta: { texto: 'Manter minha conta ativa', url: plansUrl },
      tone: 'neutral',
    }),

  retention7: (deleteAt: Date, plansUrl: string) =>
    renderEmail({
      headline: 'Seus dados serão removidos em 7 dias',
      body: [
        `A remoção está marcada para ${formatDate(deleteAt)} e é definitiva.`,
        'Se quiser manter o histórico, contrate um plano antes dessa data — ou exporte seus pacientes e negócios enquanto o acesso continua aberto.',
      ],
      cta: { texto: 'Contratar um plano', url: plansUrl },
      tone: 'urgent',
    }),

  // ── COBRANÇA ────────────────────────────────────────────────────────────
  paymentOverdue: (
    valor: string,
    vencimento: string,
    ate: string,
    invoiceUrl: string
  ) =>
    renderEmail({
      headline: 'Sua mensalidade está em aberto',
      body: [
        `A cobrança de ${valor} venceu em ${vencimento}.`,
        `Você tem até ${ate} para pagar sem interrupção. Depois dessa data a clínica fica em somente-leitura: as mensagens continuam chegando e o histórico fica inteiro, mas o envio e o agente param.`,
        'Se já pagou nas últimas horas, pode ignorar — a confirmação do banco leva alguns minutos.',
      ],
      cta: { texto: 'Ver a fatura', url: invoiceUrl },
      tone: 'urgent',
    }),

  accessSuspended: (invoiceUrl: string) =>
    renderEmail({
      headline: 'A clínica está em somente-leitura',
      body: [
        'A cobrança em aberto passou do prazo e o envio de mensagens foi pausado. O agente parou de responder, e os números de WhatsApp continuam conectados.',
        'Nada foi apagado: conversas, pacientes, agenda e histórico continuam inteiros e exportáveis.',
        'Pagar restaura tudo na hora, sem reconectar nada.',
      ],
      cta: { texto: 'Pagar agora', url: invoiceUrl },
      tone: 'urgent',
    }),
}

function formatDate(date: Date): string {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}
