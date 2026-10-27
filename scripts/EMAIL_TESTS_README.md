# Testador de E-mails Transacionais

Scripts para validar o envio de cada um dos 11 e-mails transacionais do OdontoBox360.

## 📋 Os 11 E-mails

| # | E-mail | Tipo | Acionador |
|---|--------|------|-----------|
| 1 | Reset de Senha | direto | Better Auth |
| 2 | Bem-vindo | direto | Onboarding |
| 3 | Convite | direto | Admin cria membro |
| 4 | Pagamento OK | direto | Webhook Asaas |
| 5 | Faltam 2 Dias | fila | Cron (trial) |
| 6 | Último Dia | fila | Cron (trial) |
| 7 | Avaliação Encerrada | fila | Cron (trial) |
| 8 | 80% Créditos | fila | Cron |
| 9 | 60 Dias para Deleção | fila | Cron (retenção) |
| 10 | 7 Dias para Deleção | fila | Cron (retenção) |
| 11 | Cobrança Vencida | fila | Webhook Asaas |
| 12 | Acesso Pausado | fila | Cron |

## 🚀 Uso Rápido

### Testar todos os 11 e-mails:

```bash
chmod +x scripts/test-emails-quick.sh
./scripts/test-emails-quick.sh seu@email.com
```

### Testar um e-mail específico:

```bash
npx ts-node scripts/test-emails.ts reset-password seu@email.com
npx ts-node scripts/test-emails.ts welcome seu@email.com
npx ts-node scripts/test-emails.ts invite seu@email.com
npx ts-node scripts/test-emails.ts all seu@email.com
```

## 📧 Comandos Individuais

### E-mails Diretos (entregues na hora)

```bash
# Reset de Senha
npx ts-node scripts/test-emails.ts reset-password seu@email.com

# Bem-vindo
npx ts-node scripts/test-emails.ts welcome seu@email.com

# Convite
npx ts-node scripts/test-emails.ts invite seu@email.com

# Pagamento Confirmado
npx ts-node scripts/test-emails.ts payment-confirmed seu@email.com
```

### E-mails de Cobrança (enfileirados, processados em segundos)

```bash
# Faltam 2 Dias
npx ts-node scripts/test-emails.ts trial-day5 seu@email.com workspace-id

# Último Dia
npx ts-node scripts/test-emails.ts trial-day6 seu@email.com workspace-id

# Avaliação Encerrada
npx ts-node scripts/test-emails.ts trial-ended seu@email.com workspace-id

# 80% de Créditos
npx ts-node scripts/test-emails.ts credits-80 seu@email.com workspace-id

# 60 Dias para Deleção
npx ts-node scripts/test-emails.ts retention-60 seu@email.com workspace-id

# 7 Dias para Deleção
npx ts-node scripts/test-emails.ts retention-7 seu@email.com workspace-id

# Cobrança Vencida
npx ts-node scripts/test-emails.ts payment-overdue seu@email.com workspace-id account-id

# Acesso Pausado
npx ts-node scripts/test-emails.ts access-suspended seu@email.com workspace-id account-id
```

## ⏱️ Tempo de Entrega

- **E-mails diretos** (1-4): entregues imediatamente (usando Cloudflare Email)
- **E-mails de fila** (5-12): enfileirados, processados em ~5-30 segundos

## ✅ Checklist de Validação

Após rodar os testes, verifique:

- [ ] Todos os 4 e-mails diretos chegaram na caixa de entrada
- [ ] Todos os 8 e-mails de fila chegaram na caixa de entrada (dentro de 1 minuto)
- [ ] Nenhum e-mail caiu em spam (ou verificar lá também)
- [ ] Textos em português corretos
- [ ] Links clicáveis e corretos
- [ ] Imagens carregando (logo do OdontoBox360)
- [ ] Design responsivo (testar no mobile)

## 🔧 Requisitos

- Node.js 18+
- Variáveis de ambiente configuradas (`.env`)
  - `NEXT_PUBLIC_APP_URL`
  - `BETTER_AUTH_SECRET`
  - Cloudflare Email Sending binding

## 📝 Notas

- Os scripts usam IDs de teste, não afetam dados reais
- Workspace e Account IDs podem ser fictícios para e-mails de fila
- Para validação completa em produção, use IDs reais
- Envios são rastreados em `notification_logs` para evitar duplicatas
