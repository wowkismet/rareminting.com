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

chown -R "${APP_USER}:${APP_USER}" "$APP_DIR"
ln -sfn "$RELEASE" "${APP_DIR}/current"

echo "==> Restarting service"
systemctl restart rareminting
sleep 3
systemctl is-active --quiet rareminting || {
  echo "!! service failed to start; last 40 log lines:" >&2
  journalctl -u rareminting -n 40 --no-pager >&2
  exit 1
}

echo "==> Smoke test"
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ || true)"
if [ "$code" != "200" ]; then
  echo "!! local smoke test returned HTTP ${code}" >&2
  journalctl -u rareminting -n 40 --no-pager >&2
  exit 1
fi

# Keep the five most recent releases.
ls -1dt "${APP_DIR}/releases/"*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf

echo "==> Deployed. HTTP 200 from 127.0.0.1:3000"
