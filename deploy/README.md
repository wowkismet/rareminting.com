# Deploying Rare Minting

Hostinger VPS (Ubuntu, KVM 4) + domain at GoDaddy.

Replace `<VPS_IP>` below with your server's IP, shown in hPanel under VPS.

Do these in order. Steps 4 and 5 are order-dependent — TLS cannot be issued
before DNS resolves, and DNS should not be pointed before the server answers.

---

## 0. Source

The code lives at https://github.com/wowkismet/rareminting.com — `deploy.sh`
clones from there. Push your latest work before deploying:

```powershell
cd "D:\RARE MINTING"
git push
```

Note the repository is **public**. Keep credentials, the build specification and
any strategy documents out of it — `.gitignore` already excludes `*.docx`.

## 1. Open a terminal on the VPS

Hostinger hPanel → VPS → Manage → **Browser terminal**. No SSH key needed.

## 2. Provision the server (once)

Upload `provision.sh` and `deploy.sh`, or paste them in with `nano`.

```bash
bash provision.sh staging.rareminting.com
```

Installs Node 24, Nginx, UFW; creates an unprivileged `rareminting` user; writes
the Nginx site and a systemd unit. Idempotent — safe to re-run.

## 3. Deploy the app

```bash
bash deploy.sh https://github.com/<you>/rare-minting.git main
```

Builds, assembles a timestamped release, flips the `current` symlink, restarts
the service and smoke-tests it. Fails loudly with logs if the service does not
come up.

Verify from your own machine — the site answers on the IP before any DNS:

```
curl -I http://<VPS_IP>
```

## 4. Point DNS at the server (GoDaddy)

Only now, once step 3 returns HTTP 200.

**Recommended — staging subdomain, leaves the live domain alone:**

| Field | Value |
| --- | --- |
| Type | `A` |
| Name | `staging` |
| Data | `<VPS_IP>` |
| TTL | 600 seconds |

**Or the real domain** — edit the existing `A @` record from `Parked` to
`<VPS_IP>`. Leave the `www` CNAME pointing at `rareminting.com`; it
follows the apex automatically. Do **not** convert `www` to an A record.

Leave `NS`, `SOA`, `_domainconnect` and the `_dmarc` TXT untouched.

Check propagation:

```bash
nslookup staging.rareminting.com 8.8.8.8
```

## 5. TLS

Once the name resolves to the VPS:

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d staging.rareminting.com
```

Certbot rewrites the Nginx site for HTTPS and installs a renewal timer. Confirm:

```bash
systemctl list-timers | grep certbot
```

---

## Operating it

```bash
systemctl status rareminting          # is it up
journalctl -u rareminting -f          # live logs
systemctl restart rareminting         # restart
```

**Roll back** to the previous release without rebuilding:

```bash
ls -1dt /srv/rareminting/releases/*/          # newest first
ln -sfn /srv/rareminting/releases/<older>/ /srv/rareminting/current
systemctl restart rareminting
```

## Notes

- The app listens on `127.0.0.1:3000` only. Nginx is the sole public listener,
  so port 3000 is never exposed.
- The service runs as `rareminting`, never root.
- Next's standalone output omits `.next/static` and `public/` by design;
  `deploy.sh` copies them in. Skipping that step yields an unstyled site — the
  most common standalone deployment failure.
- What ships today is a **prototype**: 200 seeded notes, no database, no
  accounts, no payments. Deploy it to staging, not to the public domain, unless
  you specifically want the demo publicly visible.
