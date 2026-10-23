#!/bin/sh
# Evolution Go vaza conexões Postgres até esgotar o `max_connections`, e aí para
# de funcionar em silêncio.
#
# Medido em 2026-10-14: 100 de 100 conexões abertas por ele, todas ociosas,
# acumuladas desde o dia anterior. Sem conseguir abrir uma conexão nova, ele não
# cria o cliente whatsmeow — e o sintoma que chega ao cliente é "o QR Code não
# aparece", com o log do contêiner dizendo:
#
#   Failed to create container: failed to upgrade database:
#   pq: sorry, too many clients already
#
# Reiniciar o contêiner devolve as conexões (100 → 6, medido) e as sessões
# voltam sozinhas pelo JID guardado, graças a CONNECT_ON_STARTUP=true — o número
# que estava no ar reconectou sem QR nenhum.
#
# Por que não matar só as conexões ociosas, que seria menos invasivo: entre elas
# está a do armazenamento de sessão do whatsmeow do número que está no ar, e não
# há como distinguir uma da outra de fora. Derrubar a errada tiraria do ar
# justamente a linha que funciona.
#
# Por que no host e não no cron do worker: para o worker reiniciar um contêiner
# vizinho seria preciso montar o socket do Docker dentro dele, o que dá ao
# código da aplicação controle sobre o host inteiro. Caro demais para um
# contorno de bug de terceiro.
#
# Vigia, não relógio: só reinicia quando passa do teto, e diz no log por quê.
set -eu

# Mesmo motivo do wa-guard: duas pilhas, nomes diferentes. Os padrões são os
# da Stay Cloud; a VPS dedicada exporta EVO_CONTAINER/EVO_PG_CONTAINER.
C=${EVO_CONTAINER:-odontobox360-evolution-go-1}
PG=${EVO_PG_CONTAINER:-postgres}
LIMITE=${LIMITE:-60}          # de 100 em max_connections
INTERVALO=${INTERVALO:-300}   # 5 min
# Nunca mais de um reinício por hora: se o problema for outro, reiniciar em
# laço não conserta e esconde a causa.
MIN_ENTRE_REINICIOS=${MIN_ENTRE_REINICIOS:-3600}

ultimo=0
agora() { date +%s; }
registra() { echo "wa-pool: $(date -u +%FT%TZ) $*"; }

ociosas() {
    docker top "$PG" 2>/dev/null | grep -c 'evogo.*idle' || true
}

registra "vigiando as conexões de $C em $PG (teto $LIMITE, a cada ${INTERVALO}s)"

while :; do
    n=$(ociosas)
    if [ "$n" -ge "$LIMITE" ]; then
        t=$(agora)
        if [ $((t - ultimo)) -lt "$MIN_ENTRE_REINICIOS" ]; then
            registra "$n conexões ociosas, acima do teto — mas houve reinício há $((t - ultimo))s; aguardando"
        else
            registra "$n conexões ociosas (teto $LIMITE) — reiniciando $C"
            if docker restart "$C" >/dev/null 2>&1; then
                ultimo=$t
                sleep 20
                registra "reiniciado; agora $(ociosas) conexões ociosas"
            else
                registra "FALHA ao reiniciar $C"
            fi
        fi
    fi
    sleep "$INTERVALO"
done
