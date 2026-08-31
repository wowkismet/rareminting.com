# Rare Minting

> Where numbers become heirlooms.

A heritage marketplace for banknotes, coins and collectibles whose serial
numbers match the dates that matter. `www.rareminting.com`

## Packages

| Package | What it is |
| --- | --- |
| [`packages/serial-engine`](packages/serial-engine) | The domain core. Parses serials, reads every plausible date, classifies the fancy-number taxonomy. Pure, zero dependencies, 126 tests. |
| [`packages/web`](packages/web) | Next.js storefront — the Heritage Vault design system and the "Find My Date" search, running on real engine output. |

## Running it

**This machine has a non-standard Node install.** There is no system-wide Node,
npm, Python, Docker or Postgres. Node 24 lives at
`C:\Users\<you>\.local\node` as a portable extract (verified against the
official SHA-256 manifest). Either add it to your PATH:

```powershell
$env:Path = "$env:USERPROFILE\.local\node;$env:Path"
```

…or install Node 24+ properly, which is the better long-term answer.

```
npm install
npm test          # serial-engine: 126 tests
npm run typecheck # all workspaces
```

Dev server, from the repo root:

```
node node_modules/next/dist/bin/next dev packages/web -p 3000
```

`.claude/launch.json` invokes Node by absolute path rather than going through
`npm`. That is deliberate: npm's lifecycle scripts shell out to a bare `node`,
which fails when Node is not on the system PATH. If you install Node properly,
the config can be simplified back to `npm run dev`.

## Status

Phase 1 in progress.

- [x] Serial-number engine — parsing, date interpretation, pattern taxonomy, matched pairs
- [x] Storefront shell — Heritage Vault design system, Find My Date search over a 200-note seed catalogue
- [ ] PostgreSQL schema and ERD
- [ ] API service, KYC, payments
- [ ] OCR / vision service (Phase 2)
- [ ] Auctions (Phase 3)

Seed inventory is generated deterministically in
[`packages/web/lib/catalogue.ts`](packages/web/lib/catalogue.ts) and analysed
through the real engine — none of the match data is hand-written. There is no
database yet.

## Compliance

The brand deliberately avoids any suggestion of official affiliation. Do not
introduce the Reserve Bank of India's name, emblem or any implication of
endorsement into the brand, domain, copy, page titles or metadata. The
non-affiliation disclaimer in the site footer is a requirement, not decoration —
see §9 of the build spec.
