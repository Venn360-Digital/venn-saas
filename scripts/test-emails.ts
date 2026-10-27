/**
 * Scripts para testar o envio de cada um dos 11 e-mails transacionais.
 *
 * Uso: npx ts-node scripts/test-emails.ts <email-type> [email-recipient]
 *
 * Tipos:
 *   1. reset-password     - E-mail de redefinição de senha
 *   2. welcome           - Bem-vindo ao novo workspace
 *   3. invite            - Convite para novo membro
 *   4. payment-confirmed - Pagamento recebido
 *   5. trial-day5        - Faltam 2 dias de avaliação
 *   6. trial-day6        - Último dia de avaliação
 *   7. trial-ended       - Avaliação encerrada
 *   8. credits-80        - 80% de créditos utilizados
 *   9. retention-60      - 60 dias até deleção
 *  10. retention-7       - 7 dias até deleção
 *  11. payment-overdue   - Cobrança vencida
 *  12. access-suspended  - Acesso pausado
 */

import { sendEmail } from '@/lib/email/send'
import { TEMPLATES } from '@/lib/email/templates'
import { sendBillingEmail } from '@/lib/email/billing'

const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://odontobox.venn360.com'

async function testResetPassword(email: string) {
  console.log(`Testing: Reset Password → ${email}`)
  const resetUrl = `${appUrl}/auth/nova-senha?token=test-token-12345`
  const html = TEMPLATES.resetPassword(resetUrl)
  const result = await sendEmail({
    to: email,
    subject: 'Redefinir sua senha — OdontoBox360',
    html,
  })
  console.log('Result:', result.ok ? '✅ Enviado' : `❌ ${result.error}`)
}

async function testWelcome(email: string) {
  console.log(`Testing: Welcome → ${email}`)
  const dashboardUrl = `${appUrl}/dashboard`
  const docsUrl = `${appUrl}/docs`
  const html = TEMPLATES.welcome(dashboardUrl, docsUrl)
  const result = await sendEmail({
    to: email,
    subject: 'Bem-vindo ao OdontoBox360',
    html,
  })
  console.log('Result:', result.ok ? '✅ Enviado' : `❌ ${result.error}`)
}

async function testInvite(email: string) {
  console.log(`Testing: Invite Member → ${email}`)
  const inviteUrl = `${appUrl}/auth/login`
  const html = TEMPLATES.inviteMember(inviteUrl)
  const result = await sendEmail({
    to: email,
    subject: 'Você foi convidado para o OdontoBox360',
    html,
  })
  console.log('Result:', result.ok ? '✅ Enviado' : `❌ ${result.error}`)
}

async function testPaymentConfirmed(email: string) {
  console.log(`Testing: Payment Confirmed → ${email}`)
  const html = TEMPLATES.paymentConfirmed('R$ 99,90', '15 de novembro', `${appUrl}/gerenciamento/conta?tab=faturas`)
  const result = await sendEmail({
    to: email,
    subject: 'Pagamento recebido — OdontoBox360',
    html,
  })
  console.log('Result:', result.ok ? '✅ Enviado' : `❌ ${result.error}`)
}

async function testTrialDay5(email: string, workspaceId: string) {
  console.log(`Testing: Trial Day 5 → ${email}`)
  await sendBillingEmail({
    workspaceId,
    kind: 'trial_day_5',
    scope: 'trial-day-5',
    context: {
      trialEndsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    },
  })
  console.log('Result: ✅ Enfileirado para processamento')
}

async function testTrialDay6(email: string, workspaceId: string) {
  console.log(`Testing: Trial Day 6 → ${email}`)
  await sendBillingEmail({
    workspaceId,
    kind: 'trial_day_6',
    scope: 'trial-day-6',
    context: {
      trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  })
  console.log('Result: ✅ Enfileirado para processamento')
}

async function testTrialEnded(email: string, workspaceId: string) {
  console.log(`Testing: Trial Ended → ${email}`)
  await sendBillingEmail({
    workspaceId,
    kind: 'trial_ended',
    scope: 'trial-ended',
  })
  console.log('Result: ✅ Enfileirado para processamento')
}

async function testCredits80(email: string, workspaceId: string) {
  console.log(`Testing: 80% Credits Used → ${email}`)
  await sendBillingEmail({
    workspaceId,
    kind: 'credits_80',
    scope: `credits-80-${new Date().toISOString().slice(0, 7)}`,
    context: {
      creditsUsed: 800,
      credits: 1000,
    },
  })
  console.log('Result: ✅ Enfileirado para processamento')
}

async function testRetention60(email: string, workspaceId: string) {
  console.log(`Testing: Retention 60 → ${email}`)
  await sendBillingEmail({
    workspaceId,
    kind: 'retention_60',
    scope: 'retention-60',
    context: {
      deleteAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    },
  })
  console.log('Result: ✅ Enfileirado para processamento')
}

async function testRetention7(email: string, workspaceId: string) {
  console.log(`Testing: Retention 7 → ${email}`)
  await sendBillingEmail({
    workspaceId,
    kind: 'retention_7',
    scope: 'retention-7',
    context: {
      deleteAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })
  console.log('Result: ✅ Enfileirado para processamento')
}

async function testPaymentOverdue(email: string, workspaceId: string, accountId?: string) {
  console.log(`Testing: Payment Overdue → ${email}`)
  await sendBillingEmail({
    workspaceId,
    accountId,
    kind: 'payment_overdue',
    scope: new Date().toISOString().slice(0, 10),
    context: {
      valor: 'R$ 99,90',
      vencimento: new Date().toLocaleDateString('pt-BR'),
      ate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR'),
    },
  })
  console.log('Result: ✅ Enfileirado para processamento')
}

async function testAccessSuspended(email: string, workspaceId: string, accountId?: string) {
  console.log(`Testing: Access Suspended → ${email}`)
  await sendBillingEmail({
    workspaceId,
    accountId,
    kind: 'access_suspended',
    scope: new Date().toISOString().slice(0, 10),
  })
  console.log('Result: ✅ Enfileirado para processamento')
}

async function testAll(email: string, workspaceId: string, accountId?: string) {
  console.log('🚀 Testando os 11 e-mails transacionais...\n')

  // E-mails diretos (Cloudflare Email)
  console.log('--- E-mails diretos ---')
  await testResetPassword(email)
  await testWelcome(email)
  await testInvite(email)
  await testPaymentConfirmed(email)

  console.log('\n--- E-mails de cobrança (fila) ---')
  // E-mails de cobrança (enfileirados)
  await testTrialDay5(email, workspaceId)
  await testTrialDay6(email, workspaceId)
  await testTrialEnded(email, workspaceId)
  await testCredits80(email, workspaceId)
  await testRetention60(email, workspaceId)
  await testRetention7(email, workspaceId)
  await testPaymentOverdue(email, workspaceId, accountId)
  await testAccessSuspended(email, workspaceId, accountId)

  console.log('\n✅ Todos os testes foram enfileirados!')
  console.log('📧 Verifique a caixa de entrada (e spam) em alguns minutos.')
}

// CLI
const [, , type, recipient = 'teste@example.com', workspace = 'test-ws', account = 'test-account'] = process.argv

if (!type || type === 'help') {
  console.log(`
Testador de E-mails OdontoBox360

Uso: npx ts-node scripts/test-emails.ts <tipo> [email] [workspace] [account]

Tipos disponíveis:
  1. reset-password      - Redefinição de senha
  2. welcome            - Bem-vindo
  3. invite             - Convite de membro
  4. payment-confirmed  - Pagamento confirmado
  5. trial-day5         - Faltam 2 dias
  6. trial-day6         - Último dia
  7. trial-ended        - Avaliação encerrada
  8. credits-80         - 80% de créditos
  9. retention-60       - 60 dias até deleção
 10. retention-7        - 7 dias até deleção
 11. payment-overdue    - Cobrança vencida
 12. access-suspended   - Acesso pausado
 13. all                - Todos os testes

Exemplos:
  npx ts-node scripts/test-emails.ts reset-password seu@email.com
  npx ts-node scripts/test-emails.ts all seu@email.com seu-workspace sua-conta
  `)
  process.exit(0)
}

switch (type.toLowerCase()) {
  case 'reset-password':
    testResetPassword(recipient).catch(console.error)
    break
  case 'welcome':
    testWelcome(recipient).catch(console.error)
    break
  case 'invite':
    testInvite(recipient).catch(console.error)
    break
  case 'payment-confirmed':
    testPaymentConfirmed(recipient).catch(console.error)
    break
  case 'trial-day5':
    testTrialDay5(recipient, workspace).catch(console.error)
    break
  case 'trial-day6':
    testTrialDay6(recipient, workspace).catch(console.error)
    break
  case 'trial-ended':
    testTrialEnded(recipient, workspace).catch(console.error)
    break
  case 'credits-80':
    testCredits80(recipient, workspace).catch(console.error)
    break
  case 'retention-60':
    testRetention60(recipient, workspace).catch(console.error)
    break
  case 'retention-7':
    testRetention7(recipient, workspace).catch(console.error)
    break
  case 'payment-overdue':
    testPaymentOverdue(recipient, workspace, account).catch(console.error)
    break
  case 'access-suspended':
    testAccessSuspended(recipient, workspace, account).catch(console.error)
    break
  case 'all':
    testAll(recipient, workspace, account).catch(console.error)
    break
  default:
    console.error(`Tipo "${type}" não reconhecido. Use "help" para ver as opções.`)
    process.exit(1)
}
