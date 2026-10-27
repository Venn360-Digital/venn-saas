#!/usr/bin/env bash
#
# Dispara o e-mail de redefinição de senha contra o ambiente escolhido, e
# imprime o que é preciso para provocar os outros dez.
#
# Este é o único dos onze que sai de fora sem sessão: os demais nascem de um
# administrador autenticado, de um cadastro, de um webhook assinado do Asaas ou
# do cron. Um script que fingisse disparar todos estaria mentindo.
#
#   ./scripts/testar-email.sh andre@venn360.com
#   APP=http://localhost:3000 ./scripts/testar-email.sh andre@venn360.com

set -euo pipefail

APP="${APP:-https://odontobox.venn360.com}"
DESTINO="${1:-}"

if [ -z "$DESTINO" ]; then
    echo "uso: $0 <endereço de e-mail> [APP=<url>]" >&2
    exit 1
fi

echo "→ ${APP}  destino: ${DESTINO}"
echo

# A rota responde 200 mesmo para endereço inexistente — de propósito, para não
# revelar quem tem conta. Então o 200 diz que a rota aceitou, não que o e-mail
# saiu: a prova é a mensagem chegar.
codigo=$(curl -sS -o /tmp/testar-email.out -w '%{http_code}' \
    -X POST "${APP}/api/auth/request-password-reset" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${DESTINO}\",\"redirectTo\":\"${APP}/nova-senha\"}")

echo "Redefinição de senha → HTTP ${codigo}"
[ -s /tmp/testar-email.out ] && cat /tmp/testar-email.out && echo

if [ "$codigo" = "200" ]; then
    echo "   A rota aceitou. Confirme a chegada na caixa (e no spam)."
    echo "   Falha de envio não aparece aqui: veja 'npx wrangler tail odontobox'."
elif [ "$codigo" = "429" ]; then
    echo "   Limite da rota: 5 pedidos por hora por endereço. Espere ou use outro."
else
    echo "   Resposta inesperada. Veja o corpo acima e 'npx wrangler tail odontobox'."
fi

cat <<'FIM'

Os outros dez, e o que provoca cada um
──────────────────────────────────────
Precisam de alguém logado:
  Convite        Gerenciamento → Usuários → novo usuário (como ADMIN/OWNER)
  Bem-vindo      concluir um cadastro novo (cria workspace)

Precisam de evento do Asaas:
  Pagamento OK   cobrança de assinatura passando a CONFIRMED/RECEIVED
  Vencida        cobrança de assinatura passando a OVERDUE

Nascem do cron, quando o estado da assinatura chega na data:
  Faltam 2 dias · Último dia · Encerrada · 80% dos créditos
  60 dias · 7 dias · Acesso pausado

  Cada um é enviado UMA vez por workspace: `notification_logs` carrega a trava.
  Para repetir um na mesma clínica, apague a linha correspondente antes.
FIM
