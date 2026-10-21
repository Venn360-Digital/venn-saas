#!/bin/sh
# Leva a licença do Evolution Go da VPS para o Neon.
#
# POR QUE ISTO EXISTE
#
# Implantação nova do Evolution Go nasce inerte: `/instance/create` responde
# 503 `LICENSE_REQUIRED` e nenhum QR nasce. A licença é gratuita, mas a ativação
# é um ato humano num painel web — e a VPS **já está ativada**. Então a saída
# barata é levar a ativação, não fazer outra.
#
# Isto é também o passo 5b do corte (`docs/migration/02-runbook.md`): sem ele, a
# infra nova sobe sem licença e sem pareamento, e o sintoma aparece **depois** do
# DNS apontado.
#
# OS DOIS BANCOS NÃO SÃO IGUAIS, E É A COISA MAIS IMPORTANTE AQUI
#
#   evogo_auth   a licença. Copiar é inofensivo a qualquer momento.
#   evogo_users  as credenciais de aparelho do whatsmeow. Copiar enquanto o
#                Evolution Go da VPS está no ar é PERIGOSO: o WhatsApp aceita
#                uma conexão por aparelho vinculado, os dois processos se
#                derrubam em laço, e o fim provável é o aparelho ser
#                DESVINCULADO — número de clínica fora do ar.
#
# Por isso o padrão leva só `evogo_auth`, e `evogo_users` exige `--sessoes` mais
# uma confirmação digitada. E mesmo com as sessões copiadas, o destino só pode
# subir com `CONNECT_ON_STARTUP=true` depois de o `evolution-go` da VPS parar.
#
# USO
#
#   export NEON_EVOGO_URL='postgresql://…'   # nunca em argumento: `ps` mostra
#   export VPS=root@157.254.207.42
#
#   sh infra/scripts/levar-licenca.sh                  # diagnóstico, não escreve
#   sh infra/scripts/levar-licenca.sh --aplicar        # leva evogo_auth
#   sh infra/scripts/levar-licenca.sh --aplicar --sessoes   # + evogo_users
#
# O dump nunca toca disco: vai do contêiner da VPS direto para o Neon, por
# stdout. O disco da VPS está a 87 % e o dump não precisa dele.
set -eu

VPS=${VPS:-}
APLICAR=0
SESSOES=0

for arg in "$@"; do
    case "$arg" in
        --aplicar) APLICAR=1 ;;
        --sessoes) SESSOES=1 ;;
        *) echo "argumento desconhecido: $arg" >&2; exit 2 ;;
    esac
done

[ -n "$VPS" ] || { echo "defina VPS=root@<host>" >&2; exit 2; }

if [ "$APLICAR" -eq 1 ] && [ -z "${NEON_EVOGO_URL:-}" ]; then
    echo "defina NEON_EVOGO_URL (por variável de ambiente, não por argumento)" >&2
    exit 2
fi

CT=supabase-db
remoto() { ssh -o BatchMode=yes "$VPS" "$@"; }

# ---------------------------------------------------------------- diagnóstico
#
# Sempre roda, inclusive com --aplicar: é leitura, e é o que diz **onde a
# licença mora**. A hipótese é `evogo_auth`, deduzida de o serviço não ter
# volume nenhum e a ativação sobreviver a recriação de contêiner. Dedução não é
# medição — estas contagens resolvem.
echo "== diagnóstico (somente leitura) =="
for banco in evogo_auth evogo_users; do
    echo "-- $banco"
    remoto "docker exec $CT psql -U postgres -d $banco -t -A -F' ' -c \
      \"select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc, relname\"" \
      | sed 's/^/     /'
done

if [ "$APLICAR" -eq 0 ]; then
    echo ""
    echo "nada foi escrito. Para levar a licença: --aplicar"
    exit 0
fi

# ------------------------------------------------------------- recusa de risco
if [ "$SESSOES" -eq 1 ]; then
    cat <<'AVISO'

ATENÇÃO — copiar evogo_users leva credencial de aparelho.
Se o `evolution-go` da VPS estiver no ar e o destino subir com
CONNECT_ON_STARTUP=true, os dois disputam o mesmo aparelho e o WhatsApp pode
DESVINCULAR o número da clínica.

Confirme que o `evolution-go` da VPS está PARADO.
AVISO
    printf "digite PARADO para continuar: "
    read -r resposta
    [ "$resposta" = "PARADO" ] || { echo "abortado."; exit 1; }
fi

# ------------------------------------------------------------------- transporte
#
# A URL do Neon viaja por stdin do shell remoto, não por argumento: argumento
# aparece em `ps` e no histórico do shell da VPS.
levar() {
    banco=$1
    echo "== levando $banco =="
    printf '%s' "$NEON_EVOGO_URL" | remoto "
        set -eu
        read -r destino
        docker exec $CT pg_dump -U postgres --no-owner --no-acl '$banco' \
          | docker exec -i $CT psql -q -v ON_ERROR_STOP=1 \"\$destino/$banco\"
    " && echo "   $banco: ok"
}

levar evogo_auth
[ "$SESSOES" -eq 1 ] && levar evogo_users

cat <<'FIM'

== conferência ==
Subir o destino e chamar /instance/create. Deixou de responder 503
LICENSE_REQUIRED? A licença atravessou.

Se ainda responder 503, a licença não estava em evogo_auth: olhe o diagnóstico
acima e repita com --sessoes.
FIM
