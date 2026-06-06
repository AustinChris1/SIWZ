# Sign in with Zcash (SIWZ)

**[Live demo and docs](https://siwz.vercel.app)** · **[ZecWall reference app](https://zecwall.vercel.app)** · **[@siwz/core on npm](https://www.npmjs.com/package/@siwz/core)**

> Drop-in, Zcash-native authentication for the open web. Three flows under one roof:

| # | Flow | Wallet support | Speed | Trade-off |
|---|---|---|---|---|
| 1 | **Memo-challenge:** send a tiny shielded payment with a unique amount, app verifies on-chain ([ZIP 321](https://zips.z.cash/zip-0321) deep link + QR). Like zcashnames. | **All shielded wallets** (Zodl, Zingo, YWallet, eZcash, Zenith, Dizzy, Cake, Unstoppable, Brave Snap, etc.) | ~75s (block confirm) | Proves spend-authority over some ZEC, not specific-key ownership |
| 2 | **Signed-message paste:** sign a SIWZ challenge with your wallet's `signmessage`, paste the signature. | `zcash-cli`, YWallet | Instant | Most wallets don't expose `signmessage` |
| 3 | **MetaMask + Zcash Snap:** Snap permission grant as identity (no challenge signature). | MetaMask + ChainSafe WebZjs Snap | Instant | Snap currently allowlists ChainSafe's own dApp only |

The original SIWE-style pitch (sign-message-with-your-address) doesn't survive contact with the Zcash wallet landscape. Most wallets don't implement `signmessage`, and asking shielded users to authenticate via legacy transparent t-addrs is the wrong direction. **Memo-challenge is the primary flow**: it works with every wallet that sends shielded payments (i.e. all of them), uses Zcash's actual privacy strengths, and is the same pattern [zcashnames](https://zcashnames.com) already uses.

## Install

```bash
npm i @siwz/react @siwz/next-auth @siwz/core
```

## Minimal example: memo-challenge

```tsx
import { MemoSignIn } from "@siwz/react"; // full wiring in apps/zecwall

<MemoSignIn />
```

On the server, three endpoints:
- `POST /api/auth/memo/issue` → returns ZIP 321 URI + signed token
- `POST /api/auth/memo/poll` → looks up the txid via your block-explorer client
- NextAuth credentials provider that consumes the verify envelope

## What's in this repo

| Package | What it is |
|---|---|
| [`@siwz/core`](./packages/siwz-core) | Protocol primitives: message format, address parsing, signature verification. Zero React/Next deps. |
| [`@siwz/react`](./packages/siwz-react) | The `<SignInWithZcash />` React component and `useSiwz()` hook. Optional MetaMask + Zcash-Snap one-click flow with graceful fallback to paste. |
| [`@siwz/next-auth`](./packages/siwz-next-auth) | NextAuth.js v4 / Auth.js v5 credentials provider. Includes stateless signed-nonce helpers. |
| [`apps/zecwall`](./apps/zecwall) | ZecWall: minimal Zcash-gated comments wall consuming the packages end to end. The shortest possible SIWZ integration. |
| [`apps/site`](./apps/site) | The siwz.vercel.app landing page. |
| [`apps/lightwallet-rpc`](./apps/lightwallet-rpc) | `zingo-cli`-backed HTTPS wrapper for shielded sign-in. Ships as a multi-arch Docker image to GHCR. |

## Try the reference app locally

[ZecWall](./apps/zecwall) is a Zcash-gated comments wall: the shortest end-to-end SIWZ integration. It runs live at [zecwall.vercel.app](https://zecwall.vercel.app).

```bash
pnpm install
cp apps/zecwall/.env.example apps/zecwall/.env.local
# generate a NEXTAUTH_SECRET and paste it into apps/zecwall/.env.local:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

pnpm --filter @siwz/zecwall dev
```

Open [http://localhost:3001](http://localhost:3001), sign in with any of the three flows, and post a comment. `SIWZ_DEMO=1` (the default in `.env.example`) lets the memo flow complete without a real on-chain payment; set `SIWZ_DEMO=0` plus a `SIWZ_SERVICE_ADDRESS` you own to check real transactions.

Need a service address? `node scripts/gen-service-address.mjs` writes a fresh t-addr keypair to a gitignored file.

## How signing actually works

1. **Server issues a nonce.** Stateless, HMAC-signed with `NEXTAUTH_SECRET`. The client receives `{nonce, token}`. Replay-proof and multi-instance-safe out of the box.
2. **Client builds a SIWZ message** containing the domain, address, nonce, issued-at, optional expiry, and a human-readable statement. The format mirrors EIP-4361 (with `Network:` replacing `Chain ID:` since Zcash has no chain id).
3. **User signs in their wallet.** For a t-addr, that's `zcash-cli signmessage "<address>" "<message>"` or the equivalent in Zodl / Zingo / YWallet. For shielded addresses, [ZIP 304](https://zips.z.cash/zip-0304) signing or the memo-challenge fallback.
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
- Shielded memo decryption via [`apps/lightwallet-rpc`](./apps/lightwallet-rpc): a `zingo-cli`-backed HTTPS wrapper that ships as a multi-arch Docker image with GHCR auto-publish.

**Where Zcash is going and where SIWZ goes with it:**
- **[ZIP 304](https://zips.z.cash/zip-0304) Sapling signed messages.** SIWZ exposes a `saplingVerifier` plug-point in `verifyMessage`; drop in a WASM wrapper around `librustzcash` and z-addr `signmessage` lights up. Distribution problem, not protocol problem.
- **Orchard signing.** Once the ZIP lands and wallets converge, the same dispatcher slot accepts an `orchardVerifier` callback. Same shape, different curve.
- **[NU6 + ZSAs](https://zips.z.cash/zip-0226).** Zcash Shielded Assets unlock a fourth sign-in flow: issue a non-transferable ZSA representing membership in a team or DAO; sign in by proving you hold it. No payment, no signature, no QR. SIWZ's `MemoExplorer` abstraction extends naturally to a "does this address hold ZSA X" predicate.
- **[FROST](https://frost.zfnd.org/) threshold signing.** Already landing in the Zcash ecosystem for multi-party shielded spends. SIWZ's challenge-issuance + verifier shape composes cleanly with FROST signing once consumer wallets ship support.
- **MetaMask Snap origin allowlist.** When ChainSafe broadens `endowment:rpc.allowedOrigins`, the Snap flow lights up across third-party origins automatically; no SIWZ-side change.

The thesis: SIWZ is shaped so each Zcash protocol upgrade (NU6, ZSAs, mature ZIP 304, FROST) becomes a plug-in, not a rewrite. Every flow that ships today is structured around a verifier callback or explorer interface that the next-cycle primitive slots into without breaking consumers.

**Live with the ecosystem.** As of June 2026, ZF added PCZT support to `zcash-sign` and continues threshold-signing work on FROST. SIWZ tracks the same standardized transaction formats so consumer apps built on it can adopt PCZT and FROST without protocol-level changes.

## License

MIT. Built for the Zechub hackathon.
