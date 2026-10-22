#!/bin/sh
# Leva segredos da VPS para os Secrets do Worker na Cloudflare.
#
# POR QUE ESTE SCRIPT EXISTE, e não é conveniência:
#
# 1. **Uma conexão SSH, não uma por segredo.** A primeira tentativa abriu dez em
#    rajada e o sshd as recusou (`kex_exchange_identification`), gravando um
#    segredo e relatando os outros nove como "vazio" — resultado que PARECE
#    ausência de valor e é só recusa de conexão.
# 2. **O valor nunca aparece.** Vai do SSH para o `wrangler` por pipe: não passa
#    pela tela, nem pelo clipboard, nem pelo histórico do shell, nem por
#    argumento de linha de comando (que apareceria em `ps`). A saída é só
#    nome + situação.
# 3. **Arquivo em vez de paste.** Colar bloco multilinha no terminal truncou a
#    primeira linha duas vezes (`TMP` virou `MP`), e o redirecionamento foi para
#    lugar nenhum.
#
# ONDE ELE PROCURA, em ordem, e a terceira é a que importa
#
#   /opt/app/compose/.env          o .env do compose
#   /opt/app/odontobox360/.env     o .env do projeto
#   docker exec <app> env          o ambiente do contêiner EM EXECUÇÃO
#
# A terceira é a autoridade: é o que o processo realmente lê. As duas primeiras
# podem estar desatualizadas, e no caso do OdontoBox360 estavam — as chaves
# procuradas não estavam em nenhum dos dois arquivos.
#
# USO
#
#   export VPS=root@157.254.207.42
#   sh infra/scripts/levar-segredos.sh            # só descobre, não grava
#   sh infra/scripts/levar-segredos.sh --aplicar  # grava no Worker
#
set -eu

VPS=${VPS:-}
WORKER=${WORKER:-odontobox}
APLICAR=0
[ "${1:-}" = "--aplicar" ] && APLICAR=1

[ -n "$VPS" ] || { echo "defina VPS=root@<host>" >&2; exit 2; }

# Os três que vêm da VPS, e só eles. Medido em 2026-10-21: estão no ambiente do
# contêiner em execução, NÃO nos arquivos .env, que estavam desatualizados.
#
# Quem ficou fora, e por quê — inventar valor silenciosamente seria pior que
# faltar:
#   TOKEN_ENCRYPTION_KEY   o cofre nasceu nesta migração; a VPS não o tem, e não
#                          há nada cifrado com ele para preservar. Gere novo.
#   BETTER_AUTH_SECRET     idem; e sessão não é preservada no corte (decisão 5).
#   GOOGLE_CLIENT_SECRET   resquício. Nada o lê — ver o cabeçalho de
#                          `src/lib/google-oauth-client.ts`.
#   PUBLIC/PRIVATE_STORAGE_*  tokens de API do R2, criados no painel.
CHAVES="OPENAI_API_KEY EVOLUTION_GO_API_KEY"

PADRAO=$(echo "$CHAVES" | tr ' ' '|')
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT INT TERM

echo "== buscando na VPS (uma conexão) =="

# `docker ps` descobre o contêiner do app em vez de adivinhar o nome: ele muda
# com o projeto do compose (`app`, `odontobox360-app-1`, …).
ssh -o BatchMode=yes "$VPS" "
    set -eu
    for f in /opt/app/compose/.env /opt/app/odontobox360/.env; do
        [ -f \"\$f\" ] && grep -hE '^($PADRAO)=' \"\$f\" 2>/dev/null || true
    done
    ct=\$(docker ps --format '{{.Names}}' | grep -iE '(^|[-_])app([-_]|\$)' | head -1 || true)
    [ -n \"\$ct\" ] && docker exec \"\$ct\" env 2>/dev/null | grep -hE '^($PADRAO)=' || true
" | awk -F= '!visto[$1]++' > "$TMP"

echo "   linhas recuperadas: $(wc -l < "$TMP" | tr -d ' ')"
echo
echo "== encontrados (nomes apenas) =="
cut -d= -f1 "$TMP" | sed 's/^/   /'

echo
echo "== não encontrados =="
for k in $CHAVES; do
    grep -q "^$k=" "$TMP" || echo "   $k"
done

if [ "$APLICAR" -eq 0 ]; then
    echo
    echo "nada foi gravado. Para gravar no Worker \"$WORKER\": --aplicar"
    exit 0
fi

echo
echo "== gravando em $WORKER =="
while IFS= read -r linha; do
    k=${linha%%=*}
    v=${linha#*=}
    # tira aspas em volta, se houver
    v=$(printf '%s' "$v" | sed 's/^"//;s/"$//;s/^'"'"'//;s/'"'"'$//')
    if [ -z "$v" ]; then
        echo "   vazio    $k"
        continue
    fi
    if printf '%s' "$v" | npx wrangler secret put "$k" --name "$WORKER" >/dev/null 2>&1; then
        echo "   ok       $k"
    else
        echo "   FALHOU   $k"
    fi
done < "$TMP"
