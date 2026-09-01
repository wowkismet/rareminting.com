#!/usr/bin/env bash
#
# Build and release. Run as root on the VPS, after provision.sh:
#   bash deploy.sh https://github.com/you/rare-minting.git main
#
# Releases are timestamped and `current` is a symlink, so rolling back is
# re-pointing the symlink and restarting — no rebuild.

set -euo pipefail

REPO="${1:?usage: deploy.sh <git-url> [branch]}"
BRANCH="${2:-main}"

APP_USER="rareminting"
APP_DIR="/srv/rareminting"
BUILD_DIR="${APP_DIR}/build"
RELEASE="${APP_DIR}/releases/$(date +%Y%m%d%H%M%S)"

echo "==> Fetching ${REPO} (${BRANCH})"
rm -rf "$BUILD_DIR"
git clone --depth 1 --branch "$BRANCH" "$REPO" "$BUILD_DIR"

cd "$BUILD_DIR"
echo "==> Installing dependencies"
npm ci

echo "==> Building"
npm run build --workspace=@rareminting/web

# Next's standalone output deliberately omits static assets and public files —
# they must be copied in or the site renders unstyled. This is the single most
# common standalone deployment failure.
echo "==> Assembling release at ${RELEASE}"
mkdir -p "$RELEASE"
cp -r "${BUILD_DIR}/packages/web/.next/standalone/." "$RELEASE/"
mkdir -p "${RELEASE}/packages/web/.next"
cp -r "${BUILD_DIR}/packages/web/.next/static" "${RELEASE}/packages/web/.next/static"
if [ -d "${BUILD_DIR}/packages/web/public" ]; then
  cp -r "${BUILD_DIR}/packages/web/public" "${RELEASE}/packages/web/public"
fi

if [ ! -f "${RELEASE}/packages/web/server.js" ]; then
  echo "!! server.js missing — build did not produce a standalone bundle" >&2
  exit 1
fi

# The API runs from source (Node executes TypeScript directly), so it ships as
# the package plus the workspace node_modules it imports.
echo "==> Assembling the API"
mkdir -p "${RELEASE}/api"
cp -r "${BUILD_DIR}/packages/api/." "${RELEASE}/api/"
cp -r "${BUILD_DIR}/packages/db"     "${RELEASE}/db"
cp -r "${BUILD_DIR}/packages/config" "${RELEASE}/config"
cp -r "${BUILD_DIR}/packages/serial-engine" "${RELEASE}/serial-engine"
cp -r "${BUILD_DIR}/node_modules" "${RELEASE}/api/node_modules"

# The API resolves its siblings through node_modules; point them at this release.
mkdir -p "${RELEASE}/api/node_modules/@rareminting"
for pkg in db config serial-engine; do
  ln -sfn "${RELEASE}/${pkg}" "${RELEASE}/api/node_modules/@rareminting/${pkg}"
done

chown -R "${APP_USER}:${APP_USER}" "$APP_DIR"
ln -sfn "$RELEASE" "${APP_DIR}/current"

# Migrations run before the new code starts, and are idempotent.
if [ -f /etc/rareminting.env ]; then
  echo "==> Applying database migrations"
  set -a; . /etc/rareminting.env; set +a
  ( cd "${RELEASE}/db" && node src/migrate.ts ) || {
    echo "!! migrations failed; not restarting the services" >&2
    exit 1
  }
else
  echo "!! /etc/rareminting.env missing — run provision.sh first" >&2
  exit 1
fi

echo "==> Restarting services"
systemctl restart rareminting
systemctl restart rareminting-api
sleep 3
for unit in rareminting rareminting-api; do
  systemctl is-active --quiet "$unit" || {
    echo "!! $unit failed to start; last 40 log lines:" >&2
    journalctl -u "$unit" -n 40 --no-pager >&2
    exit 1
  }
done

echo "==> Smoke test"
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ || true)"
if [ "$code" != "200" ]; then
  echo "!! local smoke test returned HTTP ${code}" >&2
  journalctl -u rareminting -n 40 --no-pager >&2
  exit 1
fi

# Keep the five most recent releases.
ls -1dt "${APP_DIR}/releases/"*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf

api_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/health || true)"
if [ "$api_code" != "200" ]; then
  echo "!! API health check returned HTTP ${api_code}" >&2
  journalctl -u rareminting-api -n 40 --no-pager >&2
  exit 1
fi

echo "==> Deployed. web 200 on :3000, api 200 on :4000"
