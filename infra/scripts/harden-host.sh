#!/usr/bin/env bash
# Lock the VPS down to ports 22, 80 and 443.
#
# This is not optional. The vendored Supabase compose publishes service ports on
# the host — Postgres on 5432, Kong on 8000, Studio on 3000 among them — and
# Docker writes its port mappings straight into iptables, *bypassing* ufw's
# default-deny. Without the DOCKER-USER rules below, Postgres and the Studio
# dashboard are reachable from the public internet the moment the stack boots.
#
# Run as root on the VPS, once:
#   sudo bash infra/scripts/harden-host.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root: sudo bash $0" >&2
    exit 1
fi

echo "==> Installing ufw and iptables-persistent"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ufw iptables-persistent

echo "==> Configuring ufw (host-level services)"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp  comment 'SSH'
ufw allow 80/tcp  comment 'HTTP (ACME + redirect)'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

echo "==> Restricting container-published ports"
# Docker inserts its DNAT rules before ufw's chains, so published container ports
# must be filtered in DOCKER-USER, which Docker evaluates for forwarded traffic
# and never overwrites.
iptables -N DOCKER-USER 2>/dev/null || true
iptables -F DOCKER-USER

# Keep established flows and traffic between containers working.
iptables -A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
iptables -A DOCKER-USER -i docker0 -j RETURN
iptables -A DOCKER-USER -s 172.16.0.0/12 -j RETURN
iptables -A DOCKER-USER -s 10.0.0.0/8 -j RETURN
iptables -A DOCKER-USER -s 127.0.0.0/8 -j RETURN

# Only the edge ports reach a container from outside.
iptables -A DOCKER-USER -p tcp --dport 80  -j RETURN
iptables -A DOCKER-USER -p tcp --dport 443 -j RETURN

# Everything else that Docker published — Postgres, Kong, Studio, Evolution —
# stays private. Reach them over an SSH tunnel instead.
iptables -A DOCKER-USER -j DROP

netfilter-persistent save

echo
echo "==> Done. Open to the internet: 22, 80, 443."
echo
echo "To reach a private service from your machine, tunnel it:"
echo "  ssh -N -L 8000:localhost:8000 root@<vps>   # Supabase Kong / Studio"
echo "  ssh -N -L 5432:localhost:5432 root@<vps>   # Postgres (psql, Prisma Studio)"
echo
echo "Verify from outside the VPS:"
echo "  nmap -Pn -p 22,80,443,3000,5432,8000 <vps-ip>"
