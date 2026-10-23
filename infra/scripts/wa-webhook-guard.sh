#!/bin/sh
# Reaplica o webhook de cada linha depois que o contêiner do Evolution sobe.
#
# POR QUE EXISTE
# O Evolution Go 0.7.2 recebe o webhook na requisição `/instance/connect`. Num
# restart do contêiner, `CONNECT_ON_STARTUP=true` reata a sessão pelo JID
# guardado — mas o webhook não volta junto, e o inbound passa a ser descartado
# **em silêncio**: a linha aparece conectada, o paciente manda mensagem, e nada
# chega na conversa. Na Cloudflare era o Durable Object que re-armava. Fora
# dele, ninguém re-arma — daí este vigia.
#
# E ELE NÃO É SÓ PARA O BOOT
# O `wa-guard.sh` reinicia o contêiner de propósito logo após o pareamento (o
# laço de QR do 0.7.2 derruba a sessão que acabou de criar). Ou seja: o caminho
# mais comum de perder o webhook é justamente parear uma linha nova. Por isso
# este script escuta eventos de `start` do Docker, e não só a subida da máquina.
#
# DE ONDE VEM O QUE REAPLICAR
# Da tabela `instances` do `evogo_users`, que guarda `token` e `webhook` por
# linha. Nada de variável de ambiente: reaplica exatamente o que estava
# configurado, inclusive o segredo que vai no caminho da URL.
#
# ---------------------------------------------------------------------------
# ENSAIO POR PADRÃO — LEIA ANTES DE LIGAR
# ---------------------------------------------------------------------------
# O payload abaixo espelha o que o app manda (src/lib/whatsapp/evolution-go.ts:
# `immediate`, `webhookUrl`, `subscribe`). O que NÃO está verificado é o efeito
# de `/instance/connect` sobre uma linha que JÁ está logada:
#
#   - `immediate: true`  pode forçar uma reconexão e, no pior caso, pedir QR de
#                        novo — derrubaria a linha que o script queria salvar;
#   - `immediate: false` pode ser inócuo e não gravar o webhook — aí o script
#                        não conserta nada e você acha que está protegido.
#
# Não dá para decidir isso por leitura, e no dia em que escrevi não havia
# nenhuma linha pareada para testar (`instances` vazia). Então o padrão é
# ENSAIO: registra o que faria e não chama nada.
#
# Para validar, com UMA linha pareada e de teste:
#   1. rode com WEBHOOK_GUARD_APPLY=1 e IMMEDIATE=false;
#   2. `docker restart` proposital no contêiner;
#   3. mande uma mensagem de fora e veja se ela chega na conversa;
#   4. se não chegar, repita com IMMEDIATE=true e confira se a linha sobrevive.
# Só depois disso ligue no systemd.
set -eu

C=${EVO_CONTAINER:-odontobox-evolution-evolution-go-1}
PG=${EVO_PG_CONTAINER:-odontobox-evolution-postgres-1}
EVO_DB=${EVO_DB:-evogo_users}
API=${EVO_API:-http://127.0.0.1:8080}
IMMEDIATE=${IMMEDIATE:-false}
APLICAR=${WEBHOOK_GUARD_APPLY:-0}
ESPERA=${ESPERA:-20}   # segundos entre o start e o rearme: o Evolution precisa
                       # terminar de reatar a sessão antes de aceitar connect.

EVENTOS='["MESSAGE","SEND_MESSAGE","READ_RECEIPT","CHAT_PRESENCE","CONNECTION","QRCODE","CONTACT"]'

registra() { echo "wa-webhook: $(date -u +%FT%TZ) $*"; }

# id|token|webhook de cada linha que tem webhook configurado.
linhas() {
    docker exec "$PG" psql -U postgres -d "$EVO_DB" -t -A -F '|' \
        -c "SELECT id, token, webhook FROM instances WHERE webhook IS NOT NULL AND webhook <> '';" \
        2>/dev/null
}

rearmar() {
    n=0
    linhas | while IFS='|' read -r id token webhook; do
        [ -z "${token:-}" ] && continue
        [ -z "${webhook:-}" ] && continue
        n=$((n + 1))
        if [ "$APLICAR" != "1" ]; then
            registra "ENSAIO: reaplicaria webhook da linha $id (immediate=$IMMEDIATE)"
            continue
        fi
        corpo=$(printf '{"immediate":%s,"webhookUrl":"%s","subscribe":%s}' \
            "$IMMEDIATE" "$webhook" "$EVENTOS")
        code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 -X POST \
            -H "apikey: $token" -H 'Content-Type: application/json' \
            -d "$corpo" "$API/instance/connect" 2>/dev/null || echo 000)
        case "$code" in
            2*) registra "linha $id: webhook reaplicado (HTTP $code)" ;;
            *)  registra "linha $id: FALHOU ao reaplicar (HTTP $code)" ;;
        esac
    done
    [ "$n" -eq 0 ] && registra "nenhuma linha com webhook configurado"
    return 0
}

registra "vigiando start de $C (aplicar=$APLICAR, immediate=$IMMEDIATE)"

# Rearma uma vez na subida do próprio vigia: cobre o caso de a máquina ter
# reiniciado e o contêiner já estar de pé antes deste processo existir.
sleep "$ESPERA"
rearmar

# E depois, a cada start do contêiner — inclusive o que o wa-guard provoca.
docker events --filter "container=$C" --filter 'event=start' --format '{{.Time}}' |
while read -r _; do
    registra "start detectado; aguardando ${ESPERA}s antes de rearmar"
    sleep "$ESPERA"
    rearmar
done
