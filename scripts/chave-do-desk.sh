#!/usr/bin/env bash
# Leva a chave de assinatura do Venn Desk do cofre para os Workers dos apps.
#
#   bash scripts/chave-do-desk.sh            # os seis Workers
#   bash scripts/chave-do-desk.sh odontobox  # só os dois do Odontobox
#
# Cada app assina o próprio token com a METADE PRIVADA de um par Ed25519; o
# Venn Desk conhece só a pública. É isso que permite ao Desk confiar em quem
# abriu o chamado sem nunca ler o banco de app nenhum.
#
# O valor é lido do cofre e entregue ao `wrangler secret put` pela ENTRADA
# PADRÃO — nunca como argumento (que apareceria em `ps`), nunca ecoado. Sai
# daqui só tamanho e impressão digital.
#
# Produção e homologação recebem a MESMA chave por app, de propósito: as duas
# metades públicas já estão registradas nos dois ambientes do Desk, e separar
# as privadas dobraria o cofre sem separar risco nenhum — quem tem acesso ao
# Worker de produção não precisa da chave de homologação para nada.
set -uo pipefail

COFRE="$HOME/.venn360-secrets/venn-desk/chaves-dos-apps"
[ -d "$COFRE" ] || { echo "ABORTA: $COFRE não existe." >&2; exit 1; }

# app:worker — o sufixo `-stg` é o que `cloudflare.config.ts` monta quando
# DEPLOY_ENV=stg. Worker é identidade na Cloudflare: nome errado publica outro.
ALVOS=(
  "odontobox:odontobox"
  "odontobox:odontobox-stg"
  "conecta:conecta"
  "conecta:conecta-stg"
  "stagent:stagent"
  "stagent:stagent-stg"
)

FILTRO="${1:-}"
FALHAS=0

for par in "${ALVOS[@]}"; do
  APP="${par%%:*}"
  WORKER="${par##*:}"
  [ -z "$FILTRO" ] || [ "$FILTRO" = "$APP" ] || continue

  ARQ="$COFRE/$APP.privada.jwk.json"
  if [ ! -f "$ARQ" ]; then
    printf '✗ %-16s a chave de %s não está no cofre\n' "$WORKER" "$APP" >&2
    FALHAS=$((FALHAS + 1))
    continue
  fi

  npx wrangler secret put VENN_DESK_CHAVE_PRIVADA --name "$WORKER" < "$ARQ" >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    printf '✓ %-16s %s bytes, fingerprint %s\n' \
      "$WORKER" \
      "$(wc -c < "$ARQ" | tr -d ' ')" \
      "$(shasum -a 256 "$ARQ" | cut -c1-8)"
  else
    printf '✗ %-16s o wrangler recusou — rode sem o silenciador para ver\n' "$WORKER" >&2
    FALHAS=$((FALHAS + 1))
  fi
done

[ "$FALHAS" -eq 0 ] || exit 1
echo
echo 'Agora declare VENN_DESK_CHAVE_PRIVADA nos três cloudflare.config.ts.'
echo 'A ordem importa: `bindings.secret()` é EXIGÊNCIA, e declarar antes de'
echo 'gravar faz o deploy do app falhar na validação.'
