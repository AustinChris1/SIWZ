# Sign in with Zcash (SIWZ)

> Drop-in, Zcash-native authentication for the open web. Three flows under one roof:

| # | Flow | Wallet support | Speed | Trade-off |
|---|---|---|---|---|
| 1 | **Memo-challenge** — send a tiny shielded payment with a unique amount, app verifies on-chain ([ZIP 321](https://zips.z.cash/zip-0321) deep link + QR). Like zcashnames. | **All shielded wallets** (Zodl, Zingo, YWallet, eZcash, Zenith, Dizzy, Cake, Unstoppable, Brave Snap, …) | ~75s (block confirm) | Proves spend-authority over some ZEC, not specific-key ownership |
| 2 | **Signed-message paste** — sign a SIWZ challenge with your wallet's `signmessage`, paste the signature. | `zcash-cli`, YWallet | Instant | Most wallets don't expose `signmessage` |
| 3 | **MetaMask + Zcash Snap** — Snap permission grant as identity (no challenge signature). | MetaMask + ChainSafe WebZjs Snap | Instant | Snap currently allowlists ChainSafe's own dApp only |

The original SIWE-style pitch (sign-message-with-your-address) doesn't survive contact with the Zcash wallet landscape — most wallets don't implement `signmessage`, and asking shielded users to authenticate via legacy transparent t-addrs is the wrong direction. **Memo-challenge is the primary flow**: it works with every wallet that sends shielded payments (i.e. all of them), uses Zcash's actual privacy strengths, and is the same pattern [zcashnames](https://zcashnames.com) already uses.

## Install

```bash
npm i @siwz/react @siwz/next-auth @siwz/core
```

## Minimal example — memo-challenge

```tsx
import { MemoSignIn } from "@/components/MemoSignIn"; // see apps/demo for the reference implementation

<MemoSignIn />
```

On the server, three endpoints:
- `POST /api/auth/memo/issue` → returns ZIP 321 URI + signed token
- `POST /api/auth/memo/verify` → looks up the txid via your block-explorer client
- NextAuth credentials provider that consumes the verify envelope

## What's in this repo

| Package | What it is |
|---|---|
| [`@siwz/core`](./packages/siwz-core) | Protocol primitives: message format, address parsing, signature verification. Zero React/Next deps. |
| [`@siwz/react`](./packages/siwz-react) | The `<SignInWithZcash />` React component and `useSiwz()` hook. Optional MetaMask + Zcash-Snap one-click flow with graceful fallback to paste. |
| [`@siwz/next-auth`](./packages/siwz-next-auth) | NextAuth.js v4 / Auth.js v5 credentials provider. Includes stateless signed-nonce helpers. |
| [`apps/demo`](./apps/demo) | **ZBooks** — a Next.js 14 reference app that uses SIWZ for sign-in. Accounting / reporting for teams paid in ZEC (paired hackathon submission). Folder name is `apps/demo` for legacy reasons; package is `@zbooks/app`. |
| [`docs`](./docs) | Spec, security model, wallet-integration guide. |

## Two hackathon submissions, one repo

- **SIWZ** is the auth primitive — npm packages + spec. Anyone can adopt it.
- **ZBooks** is the first app built on top — accounting for ZEC teams. It demonstrates SIWZ as real production auth, not a toy demo.

## Try ZBooks locally

```bash
pnpm install
cp apps/demo/.env.example apps/demo/.env.local
# generate a NEXTAUTH_SECRET:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# paste it into apps/demo/.env.local

pnpm dev:zbooks
```

Open [http://localhost:3000](http://localhost:3000). Sign in with any Zcash mainnet `t1…` address (you'll be the first admin), then add a UFVK on `/keys` to seed sample transactions.

If you don't have a wallet handy, the end-to-end script synthesizes a key, runs the entire SIWZ → add-UFVK → CSV-export flow, and asserts at each step:

```bash
node scripts/e2e-signin.mjs
```

The two paths SIWZ supports today:
- **Paste flow (universal).** Works with every wallet that has `signmessage`: Zodl, Zingo, YWallet, `zcash-cli`, ZecWallet, Zcashd, Zallet, …
- **MetaMask Snap (probed).** When `enableSnap` is passed to `<SignInWithZcash />`, the component detects MetaMask + the [ChainSafe WebZjs Zcash Snap](https://snaps.metamask.io/snap/npm/chainsafe/webzjs-zcash-snap/), and offers a one-click button. If the Snap doesn't expose a `signMessage` RPC yet, the component gracefully falls back to paste — so the integration lights up automatically when upstream lands the method.

## How signing actually works

1. **Server issues a nonce.** Stateless, HMAC-signed with `NEXTAUTH_SECRET`. The client receives `{nonce, token}`. Replay-proof and multi-instance-safe out of the box.
2. **Client builds a SIWZ message** containing the domain, address, nonce, issued-at, optional expiry, and a human-readable statement. The format mirrors EIP-4361 (with `Network:` replacing `Chain ID:` since Zcash has no chain id).
3. **User signs in their wallet.** For a t-addr, that's `zcash-cli signmessage "<address>" "<message>"` — or the equivalent in Zodl / Zingo / YWallet. For shielded addresses, [ZIP 304](https://zips.z.cash/zip-0304) signing or the memo-challenge fallback.
4. **Client posts `{message, signature, nonceToken}`** to NextAuth's credentials endpoint.
5. **Server verifies** via `@siwz/core`'s `verifyMessage`: parses the message, checks the nonce HMAC, checks domain & time window, then recovers the secp256k1 public key and re-derives the t-addr's HASH160. Match ⇒ authenticated.

Cryptographic detail: SIWZ uses the same wire format zcashd's `signmessage` RPC uses, with magic prefix `"Zcash Signed Message:\n"`. That means any wallet that implements Zcash signmessage out of the box also produces SIWZ-compatible signatures.

## Status & roadmap

**Working today:**
- **Memo-challenge sign-in** (primary flow): `<MemoSignIn />` + drop-in `issueMemoHandler` / `pollMemoHandler` + `SiwzMemoProvider`. Free transparent explorer chain (3xpl + Blockchair fallback) by default; bring-your-own shielded explorer for `zs…` / `u1…` service addresses.
- Transparent (`t1…`, `tm…`) signed-message via `<SignInWithZcash />` + `SiwzProvider`.
- MetaMask + Zcash-Snap permission-based auth (architectural integration ready; gated by ChainSafe's allowlist upstream).
- Matching `<SignOut />` component with idle / busy / confirm states.
- 59 unit tests covering ZIP 321 round-trip, memo-challenge HMAC, message format, address parsing, signature verify.
- Shielded memo decryption via [`apps/lightwallet-rpc`](./apps/lightwallet-rpc) — a `zingo-cli`-backed HTTPS wrapper that ships as a multi-arch Docker image with GHCR auto-publish.
- ZBooks: real UFVK sync against `apps/lightwallet-rpc`, transaction tagging, monthly P&L, CSV export, multi-user roles + RBAC, three sign-in flows, non-custodial multi-recipient ZIP 321 payouts with auto-reconciliation against the treasury UFVK.
- AES-256-GCM encryption-at-rest for UFVKs, owner-gated key mutation, rate-limited memo endpoints, stale-sync recovery.
- Three end-to-end test scripts proving the full server-side path for each flow.

**Where Zcash is going and where SIWZ goes with it:**
- **[ZIP 304](https://zips.z.cash/zip-0304) Sapling signed messages.** SIWZ exposes a `saplingVerifier` plug-point in `verifyMessage`; drop in a WASM wrapper around `librustzcash` and z-addr `signmessage` lights up. Distribution problem, not protocol problem.
- **Orchard signing.** Once the ZIP lands and wallets converge, the same dispatcher slot accepts an `orchardVerifier` callback — same shape, different curve.
- **[NU6 + ZSAs](https://zips.z.cash/zip-0226).** Zcash Shielded Assets unlock a fourth sign-in flow: issue a non-transferable ZSA representing membership in a team / DAO / paid community; sign in by proving you hold it. No payment, no signature, no QR. For ZBooks this means treasurer-issued team membership tokens with the sign-in side falling out for free. SIWZ's `MemoExplorer` abstraction extends naturally to a "does this address hold ZSA X" predicate.
- **[FROST](https://frost.zfnd.org/) threshold signing.** Already landing in the Zcash ecosystem for multi-party shielded spends. ZBooks's payout flow is structured to absorb it: today it builds one multi-recipient ZIP 321 URI for a single treasurer to sign; tomorrow that same URI is one input to an N-of-M FROST round.
- **MetaMask Snap origin allowlist.** When ChainSafe broadens `endowment:rpc.allowedOrigins`, the Snap flow lights up across third-party origins automatically; no SIWZ-side change.

The thesis: SIWZ is shaped so each Zcash protocol upgrade (NU6, ZSAs, mature ZIP 304, FROST) becomes a plug-in, not a rewrite. Every flow that ships today is structured around a verifier callback or explorer interface that the next-cycle primitive slots into without breaking consumers.

## License

MIT. Built for the Zechub hackathon.
