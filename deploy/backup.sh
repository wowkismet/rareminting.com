#!/usr/bin/env bash
#
# Nightly backup: the database, and every seller photograph.
#
#   bash backup.sh            # take one now
#   bash backup.sh --install  # install the systemd timer that runs it nightly
#
# Photographs are the irreplaceable half. A seller will not re-shoot thirty
# banknotes because a disk failed, so losing uploads/ loses the listings in a
# way no amount of re-entry fixes.
#
# What this does NOT protect against is the disk itself dying, because the
# copies live on the same machine. It covers the far more common failures — a
# bad migration, a mistaken delete, a restore needed at short notice. Set
# BACKUP_OFFSITE to an rsync target to close the remaining gap.

set -euo pipefail

APP_DIR="/srv/rareminting"
DEST="${BACKUP_DIR:-/var/backups/rareminting}"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${DEST}/${STAMP}"

install_timer() {
  local script
  script="$(readlink -f "$0")"

  cat > /etc/systemd/system/rareminting-backup.service <<UNIT
[Unit]
Description=Back up the Rare Minting database and seller photographs
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash ${script}
# The dump reads the database URL from the same place the app does.
EnvironmentFile=-/etc/rareminting.env
UNIT

  cat > /etc/systemd/system/rareminting-backup.timer <<'UNIT'
[Unit]
Description=Nightly Rare Minting backup

[Timer]
# Just after 02:00 local, with jitter so it never contends with anything else
# starting exactly on the hour.
OnCalendar=*-*-* 02:15:00
RandomizedDelaySec=20m
Persistent=true

[Install]
WantedBy=timers.target
UNIT

  systemctl daemon-reload
  systemctl enable --now rareminting-backup.timer
  echo "==> Installed. Next run:"
  systemctl list-timers rareminting-backup.timer --no-pager
  exit 0
}

[ "${1:-}" = "--install" ] && install_timer

if [ ! -f /etc/rareminting.env ]; then
  echo "!! /etc/rareminting.env missing — cannot read DATABASE_URL" >&2
  exit 1
fi
set -a; . /etc/rareminting.env; set +a

mkdir -p "$OUT"

echo "==> Dumping the database"
# --no-owner and --no-privileges so the dump restores onto a fresh server whose
# role names need not match this one's.
pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip -9 > "${OUT}/database.sql.gz"

echo "==> Archiving photographs"
if [ -d "${APP_DIR}/uploads" ]; then
  tar -czf "${OUT}/uploads.tar.gz" -C "$APP_DIR" uploads
else
  echo "!! ${APP_DIR}/uploads does not exist — nothing to archive" >&2
fi

# Verify rather than assume. A truncated dump is still a file, and finding that
# out during a restore is the worst possible moment.
echo "==> Verifying"
gzip -t "${OUT}/database.sql.gz"
if ! zcat "${OUT}/database.sql.gz" | tail -5 | grep -q "PostgreSQL database dump complete"; then
  echo "!! dump does not end with its completion marker — treating as failed" >&2
  rm -rf "$OUT"
  exit 1
fi
[ -f "${OUT}/uploads.tar.gz" ] && gzip -t "${OUT}/uploads.tar.gz"

tables="$(zcat "${OUT}/database.sql.gz" | grep -c '^COPY' || true)"
echo "    ${tables} tables with data"

if [ -n "${BACKUP_OFFSITE:-}" ]; then
  echo "==> Copying off this machine"
  rsync -az --delete "${OUT}/" "${BACKUP_OFFSITE}/${STAMP}/"
else
  echo "!! BACKUP_OFFSITE not set — copies live only on this disk, so a disk"
  echo "   failure loses them along with the original."
fi

# Keep the most recent, discard the rest.
find "$DEST" -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n "+$((KEEP + 1))" | while read -r old; do
  echo "==> Removing old backup $(basename "$old")"
  rm -rf "$old"
done

echo "==> Done: ${OUT}"
du -sh "$OUT"
