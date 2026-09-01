#!/usr/bin/env bash
#
# One-time server setup for a fresh Ubuntu VPS.
# Run as root, once:   bash provision.sh staging.rareminting.com
#
# Idempotent — safe to re-run. Does NOT deploy the app; run deploy.sh after.

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: provision.sh <domain> [more domains...]" >&2
  echo "  e.g. provision.sh srv1936995.hstgr.cloud staging.rareminting.com" >&2
  exit 1
fi
DOMAINS="$*"
PRIMARY="$1"
APP_USER="rareminting"
APP_DIR="/srv/rareminting"
PORT="3000"

echo "==> Provisioning for: ${DOMAINS}"

# --- packages -----------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git nginx ufw ca-certificates gnupg postgresql postgresql-contrib

# --- Node 24 (NodeSource) ----------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1)" != "v24" ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
echo "==> node $(node -v), npm $(npm -v)"

# --- unprivileged app user ---------------------------------------------
# The app never runs as root. If it is ever compromised, the blast radius
# is this one directory.
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  adduser --system --group --home "$APP_DIR" "$APP_USER"
fi
mkdir -p "$APP_DIR/releases"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# --- database -----------------------------------------------------------
# Postgres listens on localhost only; the firewall never opens 5432.
systemctl enable --now postgresql

DB_NAME="rareminting"
DB_USER="rareminting"
ENV_FILE="/etc/rareminting.env"

if ! sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='${DB_USER}'" | grep -q 1; then
  # Generated here and never printed: nothing needs to read it but the service.
  DB_PASS="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
  sudo -u postgres psql -c "create role ${DB_USER} login password '${DB_PASS}'" >/dev/null
  sudo -u postgres psql -c "create database ${DB_NAME} owner ${DB_USER}" >/dev/null

  install -m 600 /dev/null "${ENV_FILE}"
  cat > "${ENV_FILE}" <<ENVFILE
# Written by provision.sh. Readable by root only.
DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}
NODE_ENV=production
PORT=4000
HOST=127.0.0.1
TRUST_PROXY=1
# Payment keys go here. Use rzp_test_ until the flow is proven.
# RAZORPAY_KEY_ID=
# RAZORPAY_KEY_SECRET=
# RAZORPAY_WEBHOOK_SECRET=
ENVFILE
  echo "==> database created; credentials written to ${ENV_FILE}"
else
  echo "==> database role already exists; leaving ${ENV_FILE} untouched"
fi

# --- firewall -----------------------------------------------------------
# Order matters: allow SSH *before* enabling, or you lock yourself out.
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status verbose

# --- nginx reverse proxy ------------------------------------------------
cat > /etc/nginx/sites-available/rareminting <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAINS};

    # Next.js emits immutable, content-hashed asset filenames.
    location /_next/static/ {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_cache_valid 200 60m;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # The API is a separate service on 4000. Strip the /api prefix so the
    # service sees the paths it actually registers.
    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

ln -sfn /etc/nginx/sites-available/rareminting /etc/nginx/sites-enabled/rareminting
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# --- systemd unit -------------------------------------------------------
# Binds to loopback only; nginx is the sole public listener.
cat > /etc/systemd/system/rareminting.service <<UNIT
[Unit]
Description=Rare Minting web
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}/current/packages/web
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/rareminting-api.service <<UNIT
[Unit]
Description=Rare Minting API
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}/current/api
EnvironmentFile=/etc/rareminting.env
ExecStart=/usr/bin/node src/server.ts
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable rareminting
systemctl enable rareminting-api

cat <<DONE

==> Provisioning complete.

Next:
  1. bash deploy.sh <git-url> [branch]
  2. Point DNS at this server, wait for it to resolve
  3. certbot --nginx -d ${PRIMARY}      (only after DNS resolves)

DONE
