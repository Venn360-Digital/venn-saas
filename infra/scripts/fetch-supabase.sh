#!/usr/bin/env bash
# Vendor the official self-hosted Supabase compose files into infra/supabase.
#
# Writing this stack by hand would mean maintaining ~400 lines of service config
# (kong, gotrue, postgrest, realtime, storage, imgproxy, meta, studio, vector,
# analytics, supavisor) that upstream changes regularly. Pulling it instead keeps
# us on a configuration Supabase actually tests.
#
# The resolved commit is recorded in infra/supabase/.supabase-ref so a deploy can
# be reproduced, and so an upgrade is a visible diff rather than a surprise.
set -euo pipefail

REF="${SUPABASE_DOCKER_REF:-master}"
INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$INFRA_DIR/supabase"
TMP="$(mktemp -d)"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "==> Fetching supabase/supabase docker/ at ref '$REF'"

git -C "$TMP" init -q
git -C "$TMP" remote add origin https://github.com/supabase/supabase.git
git -C "$TMP" config core.sparseCheckout true
echo "docker/*" > "$TMP/.git/info/sparse-checkout"
git -C "$TMP" fetch -q --depth 1 origin "$REF"
git -C "$TMP" checkout -q FETCH_HEAD

RESOLVED="$(git -C "$TMP" rev-parse HEAD)"

if [ -d "$TARGET" ]; then
    echo "==> Backing up existing $TARGET to $TARGET.bak"
    rm -rf "$TARGET.bak"
    mv "$TARGET" "$TARGET.bak"
fi

mkdir -p "$TARGET"
cp -R "$TMP/docker/." "$TARGET/"

# Keep .env.example. The compose file needs ~80 variables that have no defaults,
# and upstream's example is the only authoritative list of them — it is the
# template setup-env.mjs builds infra/.env from. Only a stale .env is removed, so
# a re-fetch never clobbers live secrets.
rm -f "$TARGET/.env"

printf 'ref=%s\ncommit=%s\nfetched_at=%s\n' \
    "$REF" "$RESOLVED" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$TARGET/.supabase-ref"

echo "==> Vendored at commit $RESOLVED"
echo "    Volumes and seeds: $TARGET/volumes"
echo
echo "Next:"
echo "  node infra/scripts/setup-env.mjs --domain <your-domain>"
echo "  docker compose -f infra/compose.yaml config >/dev/null   # validate"
