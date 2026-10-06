#!/usr/bin/env bash
# Store the transactional e-mail provider's API key in the Supabase stack's .env.
#
# Prompts instead of taking an argument, for two reasons: a key passed on the
# command line lands in shell history, and it is visible in `ps` for as long as
# the process runs. Reading it into a variable avoids both.
#
# Usage, from your own machine:
#   ssh -t root@<vps> "bash /opt/app/odontobox360/infra/scripts/set-smtp-key.sh"
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/app/compose/.env}"
VAR="${VAR:-SMTP_PASSWORD}"

[ -f "$ENV_FILE" ] || { echo "Not found: $ENV_FILE" >&2; exit 1; }

printf 'Cole a API key e pressione Enter (não aparece na tela): '
IFS= read -rs KEY
printf '\n'

[ -n "$KEY" ] || { echo "Nada colado — nada alterado." >&2; exit 1; }

case "$KEY" in
    *[[:space:]]*) echo "A chave contém espaço — provavelmente colou algo a mais." >&2; exit 1 ;;
esac

TS=$(date +%Y%m%d-%H%M%S)
cp -a "$ENV_FILE" "$ENV_FILE.bak-$TS"
chmod 600 "$ENV_FILE.bak-$TS"

# python rather than sed: a key can contain characters sed would treat as part of
# the replacement expression, and it writes the value without it ever reaching a
# command line.
KEY="$KEY" VAR="$VAR" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import os, re, pathlib
p = pathlib.Path(os.environ['ENV_FILE'])
var, key = os.environ['VAR'], os.environ['KEY']
lines = p.read_text().split('\n')
pat = re.compile(rf'^{re.escape(var)}=')
for i, line in enumerate(lines):
    if pat.match(line):
        lines[i] = f'{var}={key}'
        break
else:
    lines.append(f'{var}={key}')
p.write_text('\n'.join(lines))
PY
unset KEY
chmod 600 "$ENV_FILE"

echo "Gravado em $ENV_FILE  (backup: $(basename "$ENV_FILE").bak-$TS)"
echo "Conferência — primeiros caracteres apenas:"
grep -E "^$VAR=" "$ENV_FILE" | sed -E 's/^([A-Z_]+=.{0,6}).*/\1…/'
