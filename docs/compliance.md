# Compliance and pre-launch checklist

**Operating entity: Lexoraa Luxury Private Limited.** Rare Minting is a brand of
that company. Everything below follows from that — the legal name on the site,
on invoices, and on the merchant account must all be the same entity.

Nothing here is legal advice. It is the list of things a marketplace of this
shape is normally expected to have, assembled so that a lawyer can review a
concrete list rather than a blank page. Have counsel confirm before launch, as
§9 of the build specification already says.

---

## 1. Entity details

Anything still marked _to supply_ is deliberately blank rather than guessed —
inventing a grievance officer would put a false record on a public site.

| Field | Value | Where it appears |
| --- | --- | --- |
| Legal name | Lexoraa Luxury Private Limited | Footer, About, invoices, gateway |
| CIN | U46620MH2009PTC197360 | Footer, About |
| GSTIN | 27AACCJ2555L1ZC | Commission invoices |
| Registered address | Office No. 1028, IJMIMA Complex, Mind Space, Malad West, Mumbai 400064 | Footer or Contact page |
| Grievance officer: name | _to supply_ | Contact page |
| Grievance officer: email | _to supply_ | Contact page |
| Grievance officer: phone | _to supply_ | Contact page |
| Customer support email | _to supply_ | Contact page, order emails |

These live in `packages/config` and are rendered from there, so an invoice, a
page footer and a certificate cannot drift apart. That package's tests assert
the GSTIN checksum and the CIN structure, so a typo introduced later fails the
build instead of reaching a public page.

**What was and was not verified.** The numbers are well-formed and consistent
with each other: the GSTIN passes its own mod-36 checksum, its embedded PAN
identifies a company, and both it and the CIN place the entity in Maharashtra as
a private limited company. That is *not* the same as confirming they are
registered to this company — check the GST portal and the MCA register for that.

## 2. Pages required before payments can go live

Payment gateways check for these during activation, and the Consumer Protection
(E-Commerce) Rules expect most of them independently. Missing pages are the most
common reason a merchant application stalls.

| Page | Must state | Who decides the content |
| --- | --- | --- |
| **Terms of use** | That notes are sold as numismatic collectibles at a collector's premium, not as currency exchange. Seller obligations, buyer obligations, auction rules. | Lawyer |
| **Privacy** | What is collected, why, retention, DPDP Act consent and withdrawal, who data is shared with (gateway, KYC provider, couriers). | Lawyer |
| **Refunds & cancellations** | The inspection window, what qualifies for a refund, how long a refund takes. | **You** — this is a commercial decision, then legal review |
| **Shipping** | Dispatch times, insured shipping thresholds, delivery confirmation, unboxing-video requirement. | **You**, then legal review |
| **Contact & grievances** | Registered address, grievance officer name and contact, response timeline. | You |

The refund and shipping pages depend on decisions no one else can make for you:
how long the inspection window is, who pays return postage, and above what value
insured shipping and an unboxing video become mandatory.

## 3. Already handled in the build

- **No implication of official affiliation.** The brand deliberately avoids the
  Reserve Bank's name. The footer disclaimer is in place and the codebase carries
  a standing note not to introduce RBI naming into copy, titles or metadata.
- **Entity attribution.** The footer names Lexoraa Luxury Private Limited.
- **Consent is recorded, not assumed.** `users.consent_version` and
  `consented_at` exist for DPDP purposes.
- **Identity numbers are never stored in the clear.** `kyc_documents` keeps a
  hash and the last four characters; the document itself lives in object storage.
- **Bank details are tokenised.** `bank_accounts` holds a gateway token, the last
  four digits and the IFSC, never a full account number.
- **An append-only audit trail.** `audit_logs` cannot be updated or deleted —
  enforced by a database trigger, not by convention.
- **Publicity rights are modelled.** Personality records carry
  `is_publicly_displayable`, an image rights basis, and a takedown timestamp;
  nothing renders publicly unless the flag is set.

## 4. Payments — the structural point

Collecting a buyer's money and later paying a seller is payment aggregation,
which requires an RBI licence. The way a marketplace avoids needing one is to use
a licensed gateway's **split-settlement product** — Razorpay Route, Cashfree Easy
Split, or equivalent — so funds settle directly and never rest in the company's
own account.

Confirm Route is enabled on the Lexoraa Luxury merchant account. Plain checkout
cannot pay sellers, and enabling Route later can need separate approval.

Two consequences worth planning for:

- The **merchant display name** shown at checkout and on card statements should
  be recognisable to someone who bought from "Rare Minting". A statement reading
  only "Lexoraa Luxury" is a chargeback risk.
- **Invoices for platform commission** are issued by Lexoraa Luxury Private
  Limited under its GSTIN. Seller payouts are net of commission, GST on that
  commission, and TDS under §194-O. Confirm the current rates with your CA
  rather than hard-coding what a rate is today — `commission_rules` stores them
  as data for exactly this reason.

## 5. Credential handling

Live API keys have been shared in chat twice during this build and must be
treated as compromised. The standing rule from here:

- Development runs on **test keys** (`rzp_test_`).
- Live keys exist **only** in `/etc/rareminting.env` on the server, `chmod 600`,
  typed there directly and never committed, pasted, or emailed.
- `.gitignore` already excludes `.env` and `*.env`. The repository is public, so
  a committed secret is harvested within minutes.
- Application code reads `process.env` and never contains a literal key.
