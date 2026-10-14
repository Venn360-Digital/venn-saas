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
C=odontobox360-evolution-go-1
token_for() {  # instance uuid -> instance token, from the app database
  docker exec supabase-db psql -U postgres -t -A -c "SELECT config->>'token' FROM agent_integrations WHERE config->>'instanceId' = '$1' LIMIT 1;" 2>/dev/null
}
logged_in() {  # token -> 0 if LoggedIn=true
  curl -s -m 5 -H "apikey: $1" http://127.0.0.1:8080/instance/status 2>/dev/null | grep -q "\"LoggedIn\":true"
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
