#!/usr/bin/env bash
#
# Provision, deploy and (optionally) secure the site in one run.
#
#   bash golive.sh srv1936995.hstgr.cloud
#
# Safe to re-run: provisioning is idempotent and each deploy creates a new
# timestamped release. Stops at the first failure rather than continuing on.

set -euo pipefail

DOMAIN="${1:-srv1936995.hstgr.cloud}"
REPO="${2:-https://github.com/wowkismet/rareminting.com.git}"
BRANCH="${3:-main}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step() { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m!! %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Run this as root."

# --- preflight ----------------------------------------------------------
step "Checking that ${DOMAIN} points at this server"
SERVER_IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
RESOLVED="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"

if [ -z "$RESOLVED" ]; then
  fail "${DOMAIN} does not resolve. Fix DNS before deploying."
fi
echo "    this server : ${SERVER_IP:-unknown}"
echo "    ${DOMAIN} -> ${RESOLVED}"

DNS_OK=1
if [ -n "$SERVER_IP" ] && [ "$SERVER_IP" != "$RESOLVED" ]; then
  DNS_OK=0
  echo "    WARNING: they differ. HTTP will still work if you reach the server"
  echo "    directly, but Let's Encrypt will refuse to issue a certificate."
fi

# --- provision + deploy -------------------------------------------------
step "Provisioning (Node, Nginx, firewall, service user)"
bash "${HERE}/provision.sh" "$DOMAIN"

step "Building and releasing the application"
bash "${HERE}/deploy.sh" "$REPO" "$BRANCH"

# --- verify over HTTP ---------------------------------------------------
step "Checking the site answers over HTTP"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://127.0.0.1" -H "Host: ${DOMAIN}" || true)"
if [ "$CODE" != "200" ]; then
  journalctl -u rareminting -n 30 --no-pager >&2 || true
  fail "Nginx returned HTTP ${CODE} instead of 200."
fi
echo "    http://${DOMAIN} -> 200"

# --- TLS ----------------------------------------------------------------
# Certbot requires agreeing to the Let's Encrypt Subscriber Agreement. That is
# an agreement in your name, so this asks rather than assuming.
step "HTTPS"
if [ "$DNS_OK" -ne 1 ]; then
  echo "    Skipped: ${DOMAIN} does not resolve to this server."
  echo "    Once DNS is correct, run:"
  echo "      certbot --nginx -d ${DOMAIN}"
else
  echo "    A certificate comes from Let's Encrypt, and requesting one means"
  echo "    accepting their Subscriber Agreement:"
  echo "      https://letsencrypt.org/repository/"
  echo "    Your email is used only for expiry warnings."
  echo
  read -r -p "    Email to register (or press Enter to skip TLS for now): " LE_EMAIL

  if [ -z "$LE_EMAIL" ]; then
    echo "    Skipped. Run this yourself when ready:"
    echo "      certbot --nginx -d ${DOMAIN}"
  else
    apt-get install -y certbot python3-certbot-nginx
    certbot --nginx -d "$DOMAIN" --email "$LE_EMAIL" --agree-tos --no-eff-email --redirect
    systemctl list-timers 2>/dev/null | grep -q certbot \
      && echo "    Renewal timer is active." \
      || echo "    NOTE: no renewal timer found; check 'systemctl list-timers'."
  fi
fi

# --- done ---------------------------------------------------------------
SCHEME="http"
[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ] && SCHEME="https"

cat <<DONE

────────────────────────────────────────────────────────────
  Live at ${SCHEME}://${DOMAIN}

  Logs      journalctl -u rareminting -f
  Status    systemctl status rareminting
  Redeploy  bash ${HERE}/deploy.sh ${REPO} ${BRANCH}
────────────────────────────────────────────────────────────

DONE
