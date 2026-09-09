# Rare Minting — mobile

One React Native codebase for iOS and Android, built on Expo, consuming the API
that already runs at `rareminting.com/api`.

## The one architectural decision worth reading

**The backend is not being rebuilt.** The plan that came with this work proposed
Node/NestJS, PostgreSQL and Redis. Two of those already exist and are in
production: `packages/api` is Node serving 82 endpoints against PostgreSQL,
with 349 tests, handling the marketplace, the multi-seller cart, single-payment
checkout, auctions, offers, KYC, seller settlements, reviews, disputes, support
tickets and banners.

Rewriting that in NestJS would discard a year of correctness — the idempotent
payment webhooks, the basis-point money arithmetic, the append-only audit
trail — to arrive at the same endpoints with a different import statement. The
app consumes what is there.

Redis is not in this either. At the current size it would be a cache in front of
a database that answers in single-digit milliseconds. It earns its place when
something is actually slow, and nothing is.

## Running it

```bash
npm install --workspace @rareminting/mobile
npm run start --workspace @rareminting/mobile
```

Press `i` for the iOS simulator, `a` for Android, or scan the QR code with Expo
Go on a real handset.

Point it at a different API with `EXPO_PUBLIC_API_BASE`; it defaults to
production.

## Building for the stores

`eas build` compiles in the cloud, so **an iOS build does not need a Mac** —
which matters if nobody on the team has one.

```bash
npx eas build --platform android --profile production
npx eas build --platform ios --profile production
```

## What is here (phase 1)

- The brand as tokens in `theme.ts` — the same hexes as the website
- An API client that keeps the session token in the **Keychain / Keystore**,
  not AsyncStorage
- Session handling that verifies a stored token against the server on launch
- The floor: two columns, shuffled, pull to refresh
- Sign in and registration on one screen

## What is next

- Listing detail, cart, checkout against the existing group-payment endpoint
- Wishlist and collection
- Seller: listings, orders, settlements
- Auctions with live bidding
- Push notifications — the one thing with no backend behind it yet

## Two decisions already made, so they are not relitigated

**The session token lives in SecureStore.** That is the Keychain on iOS and the
Keystore on Android. AsyncStorage is a plaintext file readable by anything with
access to device storage and by any backup containing it. The web app keeps the
same token in an httpOnly cookie the browser cannot read; SecureStore is the
closest a native app gets.

**Money is never a float.** The API sends whole rupees; anything needing paise
sends them separately. A currency amount that has been through a float is a
currency amount that will eventually be a paisa short, and this app shows people
what they are about to be charged.
