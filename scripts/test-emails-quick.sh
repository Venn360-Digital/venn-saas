#!/bin/bash

# Script rápido para testar os 11 e-mails
# Uso: ./scripts/test-emails-quick.sh seu@email.com

EMAIL="${1:-seu@email.com}"
WORKSPACE="${2:-teste-workspace}"
ACCOUNT="${3:-teste-account}"

echo "=========================================="
echo "Testador de E-mails - OdontoBox360"
echo "=========================================="
echo "Email: $EMAIL"
echo "Workspace: $WORKSPACE"
echo "Account: $ACCOUNT"
echo ""

# Cores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

run_test() {
  local name="$1"
  local type="$2"
  echo -e "${BLUE}→ Testando: $name${NC}"
  npx ts-node scripts/test-emails.ts "$type" "$EMAIL" "$WORKSPACE" "$ACCOUNT"
  echo ""
}

echo -e "${GREEN}1. E-MAILS DIRETOS (Cloudflare Email)${NC}"
run_test "Reset de Senha" "reset-password"
run_test "Bem-vindo" "welcome"
run_test "Convite de Membro" "invite"
run_test "Pagamento OK" "payment-confirmed"

echo -e "${GREEN}2. E-MAILS DE COBRANÇA (Filas)${NC}"
run_test "Faltam 2 Dias" "trial-day5"
run_test "Último Dia" "trial-day6"
run_test "Avaliação Encerrada" "trial-ended"
run_test "80% Créditos" "credits-80"
run_test "60 Dias para Deleção" "retention-60"
run_test "7 Dias para Deleção" "retention-7"
run_test "Cobrança Vencida" "payment-overdue"
run_test "Acesso Pausado" "access-suspended"

echo -e "${GREEN}=========================================="
echo "✅ Todos os testes foram enfileirados!"
echo "📧 Verifique $EMAIL em alguns minutos"
echo "==========================================${NC}"
