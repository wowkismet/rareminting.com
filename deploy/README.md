# Deploying Rare Minting

Hostinger VPS (Ubuntu, KVM 4). Domain at GoDaddy, but you do not need it to get
a working HTTPS site.

**Deploy to the Hostinger hostname first.** `srv1936995.hstgr.cloud` already
resolves to the server, so you can be live on real HTTPS with no DNS change at
all — and `rareminting.com` stays parked and untouched until you actually want
to launch. Pointing your own domain becomes a one-record change afterwards.

```
srv1936995.hstgr.cloud → 200.234.42.251
                       → 2a02:4780:63:a6b1::1
```

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

```bash
cd /root
git clone https://github.com/wowkismet/rareminting.com.git
cd rareminting.com/deploy
```

## 2. Provision the server (once, ~3 minutes)

```bash
bash provision.sh srv1936995.hstgr.cloud
```

Installs Node 24 and Nginx, enables the firewall (SSH is allowed *before* UFW
comes up, so you cannot lock yourself out), creates an unprivileged
`rareminting` user, and writes the Nginx site and a systemd unit. Idempotent —
safe to re-run.

Accepts several hostnames if you want to serve your own domain alongside:

```bash
bash provision.sh srv1936995.hstgr.cloud staging.rareminting.com
```

## 3. Deploy

```bash
bash deploy.sh https://github.com/wowkismet/rareminting.com.git main
```

Builds, assembles a timestamped release, flips the `current` symlink, restarts
the service and smoke-tests it. Ends with `==> Deployed. HTTP 200 from
127.0.0.1:3000`, or fails loudly with the service logs.

Check it from your own machine:

```powershell
curl.exe -I http://srv1936995.hstgr.cloud
```

Must return `HTTP/1.1 200 OK` before step 4.

## 4. HTTPS

DNS already resolves, so this works immediately:

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d srv1936995.hstgr.cloud
```

Certbot rewrites the Nginx site for TLS and installs a renewal timer. Confirm
with `systemctl list-timers | grep certbot`.

**You now have a working site at https://srv1936995.hstgr.cloud.**

## 5. Your own domain — only when you want to launch

At GoDaddy, DNS → Add New Record:

| Field | Value |
| --- | --- |
| Type | `A` |
| Name | `staging` |
| Data | `200.234.42.251` |
| TTL | 600 seconds |

Leave `NS`, `SOA`, `_domainconnect` and the `_dmarc` TXT untouched.

To use the live domain instead, edit the existing `A @` record from `Parked` to
the server IP. Leave the `www` CNAME pointing at `rareminting.com`; it follows
the apex automatically. Do **not** convert `www` to an A record.

Then re-provision with both names and re-issue the certificate:

```bash
bash provision.sh srv1936995.hstgr.cloud staging.rareminting.com
certbot --nginx -d srv1936995.hstgr.cloud -d staging.rareminting.com
```

---

## Operating it

```bash
systemctl status rareminting          # is it up
journalctl -u rareminting -f          # live logs
systemctl restart rareminting
```

**Roll back** to the previous release without rebuilding:

```bash
ls -1dt /srv/rareminting/releases/*/          # newest first
ln -sfn /srv/rareminting/releases/<older>/ /srv/rareminting/current
systemctl restart rareminting
```

## Notes

- The app listens on `127.0.0.1:3000` only; Nginx is the sole public listener,
  so port 3000 is never exposed.
- The service runs as `rareminting`, never root.
- Next's standalone output omits `.next/static` and `public/` by design;
  `deploy.sh` copies them in. Skipping that yields an unstyled site — the most
  common standalone deployment failure.
- Nginx listens on IPv6 as well, which this host has.

## Hardening, once SSH key auth is confirmed working

The server currently accepts password auth for root, which is a standing
brute-force target. After you have verified a key login succeeds, add to
`/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PermitRootLogin prohibit-password
```

then `systemctl restart ssh`. Do this **only** after a key login is proven —
otherwise you lose SSH entirely and are left with the browser terminal.

## What actually deploys today

A prototype: 200 seeded notes, no database behind the storefront, no accounts,
payments or seller listings on the public site. The API service
(`packages/api`) has registration and sign-in but is not yet wired to the web
app or started by these scripts.
