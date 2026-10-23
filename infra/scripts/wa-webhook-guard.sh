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
# O QUE ELE NÃO CONSERTA
# O banco é a única fonte dele. Se o valor GRAVADO estiver errado, ele reaplica
# o errado — para sempre, e sem reclamar. O caso concreto: ao rotacionar
# `EVOLUTION_WEBHOOK_SECRET`, a URL no banco fica velha, o Evolution passa a
# postar num caminho que a aplicação recusa com 401, e o inbound morre em
# silêncio com este vigia dizendo "reaplicado (HTTP 200)" a cada restart.
# Rotacionar o segredo exige reconectar as linhas pela aplicação (que remonta a
# URL com o segredo novo), não só trocar o segredo.
#
# ---------------------------------------------------------------------------
# O QUE FOI PROVADO NA MÁQUINA (2026-10-23) E O QUE AINDA NÃO
# ---------------------------------------------------------------------------
# Medido na VPS com uma instância de teste criada e apagada no mesmo dia:
#
#   PROVADO  `/instance/connect` com `immediate:false` devolve 200 e GRAVA o
#            webhook e os sete eventos na tabela `instances`. Ou seja: a opção
#            não-disruptiva NÃO é inócua — era a dúvida que mantinha este
#            script parado. É por isso que o padrão aqui é `false`.
#   PROVADO  O webhook sobrevive no BANCO a um restart do contêiner.
#   PROVADO  O laço deste script funciona: reaplicou e o log confere.
#
#   NÃO PROVADO, e é o que falta: o efeito de `/instance/connect` sobre uma
#            linha JÁ LOGADA. A instância de teste nunca pareou (sem telefone),
#            então `LoggedIn` foi sempre false. Se o connect derrubar a sessão
#            de uma linha viva, este vigia vira o problema que queria resolver.
#   NÃO PROVADO: se o Evolution relê o webhook do banco sozinho ao subir. Se
#            relê, este vigia é redundante — e descobrir isso exige ver uma
#            mensagem real chegar depois de um restart.
#
# POR ISSO O PADRÃO SEGUE SENDO ENSAIO: registra o que faria e não chama nada.
# Para fechar as duas pendências, com UMA linha de teste pareada e descartável:
#   1. pareie a linha e confirme inbound funcionando;
#   2. `docker restart` no contêiner e mande uma mensagem — se chegar sem este
#      vigia rodar, ele é redundante e deve ser aposentado;
#   3. se NÃO chegar, rode com WEBHOOK_GUARD_APPLY=1 e repita: tem de chegar, e
#      a linha tem de continuar logada (`/instance/status` com LoggedIn=true).
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
    # Sem pipe para o `while`: num pipe ele roda em subshell e o contador nunca
    # sobe no shell pai — o laço reaplicava e o log dizia "nenhuma linha",
    # ao mesmo tempo (visto em 2026-10-23). Redirecionar de arquivo mantém o
    # laço no shell atual.
    tmp=$(mktemp)
    linhas > "$tmp"
    n=0
    while IFS='|' read -r id token webhook; do
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
    done < "$tmp"
    rm -f "$tmp"
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
