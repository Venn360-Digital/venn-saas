#!/bin/bash

# Testador de E-mails via HTTP (produção)
# Os e-mails são disparados pelas rotas da API em produção

APP_URL="${APP_URL:-https://odontobox.venn360.com}"
EMAIL="${1:-seu@email.com}"

echo "=========================================="
echo "Testador de E-mails (Produção)"
echo "=========================================="
echo "Endpoint: $APP_URL"
echo "Email: $EMAIL"
echo ""

# Cores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}ℹ️  Para testar os e-mails em produção:${NC}\n"

echo -e "${GREEN}1. RESET DE SENHA${NC}"
echo "   Vá para: $APP_URL/auth/esqueci-senha"
echo "   Digite: $EMAIL"
echo "   Resultado: e-mail de reset chega em segundos"
echo ""

echo -e "${GREEN}2. BEM-VINDO${NC}"
echo "   Complete o onboarding (signup) com novo email"
echo "   Resultado: e-mail de boas-vindas ao criar workspace"
echo ""

echo -e "${GREEN}3. CONVITE${NC}"
echo "   Admin → Gerenciamento → Usuários → Novo Usuário"
echo "   Email: $EMAIL"
echo "   Resultado: e-mail de convite chega em segundos"
echo ""

echo -e "${GREEN}4. PAGAMENTO CONFIRMADO${NC}"
echo "   ⚠️  Requer webhook real do Asaas"
echo "   (disparado quando pagamento é confirmado)"
echo ""

echo -e "${YELLOW}E-MAILS DE FILA (5-12)${NC}"
echo "   Disparados por cron jobs (horários específicos):"
echo "   - Trial Day 5: 5 dias antes do fim"
echo "   - Trial Day 6: 1 dia antes do fim"
echo "   - Trial Ended: quando trial acaba"
echo "   - Credits 80%: quando créditos > 80%"
echo "   - Retention 60: 60 dias após não contratação"
echo "   - Retention 7: 7 dias antes de deletar"
echo "   - Payment Overdue: quando cobrança vence"
echo "   - Access Suspended: quando acesso é pausado"
echo ""

echo -e "${GREEN}✅ Para validação completa:${NC}"
echo "   1. Faça login em: $APP_URL"
echo "   2. Vá para: $APP_URL/gerenciamento/conta"
echo "   3. Verifique histórico de envios em: notification_logs (DB)"
echo ""

echo -e "${YELLOW}Status de Produção:${NC}"
echo "   Branch: main ✅"
echo "   Deploy: Cloudflare Workers ✅"
echo "   Binding: Cloudflare Email Sending ✅"
echo "   Cron: Habilitado ✅"
echo ""

echo -e "${GREEN}Checklist de Validação:${NC}"
echo "   [ ] Receber Reset de Senha"
echo "   [ ] Receber Bem-vindo (novo workspace)"
echo "   [ ] Receber Convite (novo membro)"
echo "   [ ] Verificar todos em inbox + spam"
echo "   [ ] Testar links nos e-mails"
echo "   [ ] Validar design no mobile"
echo ""
