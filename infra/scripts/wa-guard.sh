#!/bin/sh
# Evolution Go keeps its QR goroutine running after PairSuccess and, on the 5th
# QR (~105 s), forces a logout of the session it just created. A container
# restart kills the goroutine, and CONNECT_ON_STARTUP reattaches the session by
# its stored JID with no QR. /instance/disconnect was measured NOT to work.
#
# Timing matters: a restart BEFORE the post-pairing login completes leaves a
# half-registered companion — the phone never lists the device and WhatsApp logs
# it out ~35 s later (measured 2026-10-07 on a second number; the first number
# had logged in by +16 s and survived a +25 s restart by luck). So: wait until
# /instance/status reports LoggedIn=true, then restart; cap at 70 s so the restart
# still lands before the forced logout.
# Parametrizado, e os padrões são os da VPS dedicada ao Evolution — a única
# pilha que existe desde 2026-10-23. Até ali os padrões eram os da Stay Cloud
# (`odontobox360-evolution-go-1` e o Postgres da aplicação), e as unidades da
# Vultr sobrescreviam as quatro variáveis. Com aquela máquina desligada, manter
# os nomes antigos como padrão deixava o vigia **falhando em silêncio** para
# quem o rodasse à mão: `docker exec` erra, `token_for` devolve vazio, e o
# vigia simplesmente nunca reinicia nada.
C=${EVO_CONTAINER:-odontobox-evolution-evolution-go-1}
PG=${EVO_PG_CONTAINER:-odontobox-evolution-postgres-1}
EVO_DB=${EVO_DB:-evogo_users}
API=${EVO_API:-http://127.0.0.1:8080}

# O token sai do banco do PRÓPRIO Evolution, não do banco do app.
#
# A consulta anterior lia `agent_integrations` no banco da aplicação. Na VPS
# dedicada ela não existe — o app foi para outro host —, e mesmo antes disso a
# dependência sumiria no dia da migração. A
# tabela `instances` do `evogo_users` tem `id` e `token` e pertence ao
# Evolution, então vale nas duas pilhas.
token_for() {  # instance uuid -> instance token
  docker exec "$PG" psql -U postgres -d "$EVO_DB" -t -A \
    -c "SELECT token FROM instances WHERE id = '$1' LIMIT 1;" 2>/dev/null
}
logged_in() {  # token -> 0 if LoggedIn=true
  curl -s -m 5 -H "apikey: $1" "$API/instance/status" 2>/dev/null | grep -q "\"LoggedIn\":true"
}
while :; do
  echo "wa-guard: watching $C for PairSuccess"
  docker logs -f --since 1s "$C" 2>&1 | while read -r line; do
    case "$line" in
      *"eventType PairSuccess"*)
        INST=$(printf "%s" "$line" | grep -oE "\[[0-9a-f-]{36}\]" | head -1 | tr -d "[]")
        echo "wa-guard: $(date -u +%FT%TZ) PairSuccess instance=$INST — waiting for LoggedIn (max 70s)"
        T=""; i=0
        while [ $i -lt 14 ]; do
          [ -z "$T" ] && T=$(token_for "$INST")
          if [ -n "$T" ] && logged_in "$T"; then echo "wa-guard: $(date -u +%FT%TZ) LoggedIn=true after $((i*5))s"; break; fi
          i=$((i+1)); sleep 5
        done
        [ $i -ge 14 ] && echo "wa-guard: $(date -u +%FT%TZ) LoggedIn not seen in 70s — restarting anyway"
        sleep 3
        docker restart "$C" >/dev/null && echo "wa-guard: $(date -u +%FT%TZ) restarted"
        ;;
    esac
  done
  sleep 3
done
