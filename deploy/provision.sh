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
mkdir -p "$APP_DIR/releases" "$APP_DIR/uploads"

# Identity documents. Deliberately NOT under uploads/: nginx publishes that
# directory at /media/ with no authentication, which is right for a photograph
# of a note somebody is trying to sell and catastrophic for a PAN card. These
# leave the server only through an authenticated route that checks who is
# asking, and 0700 keeps them from anything running as another user.
mkdir -p "$APP_DIR/kyc"
chmod 700 "$APP_DIR/kyc"

# Photographs a buyer sends to be printed on a frame. The same reasoning as
# kyc/ above and for the same reason: a picture of somebody's mother is not
# public the way a picture of the note they are selling is.
mkdir -p "$APP_DIR/gifts"
chmod 700 "$APP_DIR/gifts"

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# Nginx serves uploaded photographs straight off the disk, so www-data has to
# be able to traverse $APP_DIR. Giving it group membership keeps the directory
# closed to every other local account, which `chmod o+x` would not. Secrets
# live in /etc/rareminting.env (root-only, mode 600), outside this tree.
if id -u www-data >/dev/null 2>&1; then
  usermod -aG "$APP_USER" www-data
fi

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
# Cashfree. The App ID is semi-public; the secret key is not, and belongs
# here and in a password manager and nowhere else -- never in the repository,
# a ticket, or a chat window. Cashfree signs its webhooks with this same
# secret, so leaking it is enough to forge a "payment received".
#
# CASHFREE_MODE must say production in as many words before real money can be
# taken; anything else points at the sandbox. Leave it unset while testing.
# CASHFREE_APP_ID=
# CASHFREE_SECRET_KEY=
# CASHFREE_MODE=production
#
# Where Cashfree sends the buyer back to, and where it posts webhooks. Both
# must be reachable from the public internet.
SITE_URL=https://${PRIMARY}
# Shiprocket, the delivery partner. The password is a real account password,
# not a scoped API key -- it signs in to the dashboard too -- so it belongs
# here and in a password manager and nowhere else. SHIPROCKET_PICKUP_LOCATION
# must match a pickup nickname that exists in the dashboard or every booking
# is refused. The webhook token is invented here and pasted into Shiprocket;
# it is all the authentication their callback offers.
# SHIPROCKET_EMAIL=
# SHIPROCKET_PASSWORD=
# SHIPROCKET_PICKUP_LOCATION=Primary
# SHIPROCKET_WEBHOOK_TOKEN=
# SMS provider for one-time codes. Unset means OTP is switched off, and the
# service says so rather than letting anyone past.
# SMS_PROVIDER=
ENVFILE
  echo "==> database created; credentials written to ${ENV_FILE}"
else
  echo "==> database role already exists; leaving ${ENV_FILE} untouched"
fi

# --- shared, non-secret settings ----------------------------------------
# Read by both services. Deliberately separate from /etc/rareminting.env:
# the web process has no business holding the database password or the
# payment secret, and one EnvironmentFile for everything would give it both.
cat > /etc/rareminting-public.env <<PUBENV
# Non-secret settings shared by the web and api services.
AUCTIONS_ENABLED=true
SITE_URL=https://${PRIMARY}
PUBENV
chmod 644 /etc/rareminting-public.env

# --- KYC pepper ---------------------------------------------------------
# The key that turns a PAN or an Aadhaar number into a stored HMAC. Generated
# once and never rotated: every hash on file was computed with it, so replacing
# it would orphan every seller's identity record and make duplicate detection
# silently stop working. Hence the append-if-absent rather than a rewrite.
if [ ! -f "${ENV_FILE}" ]; then
  install -m 600 /dev/null "${ENV_FILE}"
fi
if ! grep -q '^KYC_NUMBER_PEPPER=' "${ENV_FILE}"; then
  PEPPER="$(head -c 48 /dev/urandom | base64 | tr -d '/+=' | head -c 48)"
  printf '\n# Generated once. Never change this: it would orphan every stored KYC hash.\nKYC_NUMBER_PEPPER=%s\n' "${PEPPER}" >> "${ENV_FILE}"
  unset PEPPER
  echo "==> KYC pepper generated"
else
  echo "==> KYC pepper already present; left untouched"
fi
chmod 600 "${ENV_FILE}"

# --- firewall -----------------------------------------------------------
# Order matters: allow SSH *before* enabling, or you lock yourself out.
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status verbose

# --- nginx security headers ---------------------------------------------
# In a snippet rather than inline, for two reasons: certbot rewrites the site
# file and would drop anything it does not recognise, and nginx discards the
# whole inherited add_header set the moment a location adds one of its own --
# so the locations that set their own have to include this back.
mkdir -p /etc/nginx/snippets
cat > /etc/nginx/snippets/rareminting-security.conf <<SECHEADERS
# A year of HTTPS-only. Without includeSubDomains on purpose: it would bind
# subdomains that do not exist yet to HTTPS for a year, and that is a long
# time to be wrong about.
add_header Strict-Transport-Security "max-age=31536000" always;

# Visitor-supplied files are served from this origin, so a browser must never
# be talked into deciding a JPEG is really a script.
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" always;

# REPORT-ONLY until the violation reports are quiet. An over-tight policy here
# breaks the payment SDK silently, which is the worst possible way to find out.
add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.cashfree.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://sdk.cashfree.com https://api.cashfree.com; frame-src https://sdk.cashfree.com https://*.cashfree.com; form-action 'self' https://*.cashfree.com; object-src 'none'; base-uri 'self'" always;
SECHEADERS

# Do not advertise the exact nginx build in every response.
sed -i "s/^\(\s*\)server_tokens .*/\1server_tokens off;/" /etc/nginx/nginx.conf || true
grep -q "server_tokens" /etc/nginx/nginx.conf || sed -i "s/^\(\s*\)sendfile on;/\1server_tokens off;\n\1sendfile on;/" /etc/nginx/nginx.conf

# --- nginx reverse proxy ------------------------------------------------
# The heredoc is quoted, so bash expands nothing and every Nginx variable is
# written literally. The two values that genuinely come from this script are
# substituted afterwards. Escaping each $ individually is how this went wrong
# before: one missed escape and `set -u` aborts the whole provision.
cat > /etc/nginx/sites-available/rareminting <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name __DOMAINS__;

    # A listing is a photograph of a banknote taken on a phone, which is
    # routinely 1.5-3 MB. Nginx defaults to 1 MB and rejects the upload with a
    # 413 before it ever reaches the application, so nothing is logged there
    # and the seller sees only a blank error. This one line is the difference
    # between a seller being able to list an item and not.
    client_max_body_size 25m;

    include /etc/nginx/snippets/rareminting-security.conf;

    # Next.js emits immutable, content-hashed asset filenames.
    location /_next/static/ {
        proxy_pass http://127.0.0.1:__PORT__;
        proxy_cache_valid 200 60m;
        add_header Cache-Control "public, max-age=31536000, immutable";
        include /etc/nginx/snippets/rareminting-security.conf;
    }

    # Seller photographs, served from disk. nosniff matters here: these are
    # visitor-supplied files, and a browser must never be talked into
    # interpreting one as script.
    location /media/ {
        alias __APP_DIR__/uploads/;
        include /etc/nginx/snippets/rareminting-security.conf;
        expires 30d;
        access_log off;
    }

    # The API is a separate service on 4000. The trailing slash on proxy_pass
    # strips the /api prefix, so the service sees the paths it registers.
    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:__PORT__;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

sed -i "s|__DOMAINS__|${DOMAINS}|g; s|__PORT__|${PORT}|g; s|__APP_DIR__|${APP_DIR}|g" \
  /etc/nginx/sites-available/rareminting

ln -sfn /etc/nginx/sites-available/rareminting /etc/nginx/sites-enabled/rareminting
rm -f /etc/nginx/sites-enabled/default
nginx -t
# A restart, not a reload: workers pick up supplementary groups only when
# they are spawned, so a reload would leave www-data unable to read uploads.
systemctl restart nginx

# Writing the site file above discards the 443 server block certbot added, which
# silently takes HTTPS down on every re-provision. If a certificate already
# exists, put it straight back.
if [ -d /etc/letsencrypt/live ] && command -v certbot >/dev/null 2>&1; then
  CERT_DOMAIN="$(ls -1 /etc/letsencrypt/live 2>/dev/null | grep -v README | head -1 || true)"
  if [ -n "${CERT_DOMAIN}" ]; then
    echo "==> Re-applying TLS for ${CERT_DOMAIN} (the new nginx config dropped it)"
    certbot --nginx --reinstall --redirect --non-interactive       --cert-name "${CERT_DOMAIN}" >/dev/null 2>&1 ||       echo "!! could not re-apply TLS; run: certbot --nginx -d ${CERT_DOMAIN}" >&2
    nginx -t && systemctl reload nginx
  fi
fi

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
# Shared flags only. The secrets file is NOT read here on purpose.
EnvironmentFile=/etc/rareminting-public.env
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
Environment=UPLOAD_DIR=${APP_DIR}/uploads
Environment=KYC_DIR=${APP_DIR}/kyc
Environment=GIFT_DIR=${APP_DIR}/gifts
EnvironmentFile=/etc/rareminting-public.env
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
