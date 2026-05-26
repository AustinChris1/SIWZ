# SIWZ memo-challenge

> The Zcash-native sign-in flow. Works with every shielded wallet today.

## Why this exists

The original SIWZ proposal mirrored [SIWE](https://eips.ethereum.org/EIPS/eip-4361): sign a challenge message with your address. That works in theory but breaks in practice — most Zcash wallets don't expose `signmessage`. `zcash-cli` does; YWallet does; Zingo / Zodl / Zashi / eZcash / Zenith / Brave / Trust / Exodus / Coinomi / SafePal / Leodex — variously missing or buried.

Worse: Zcash is a shielded-first chain, and asking users to sign with a transparent t-addr makes SIWZ-classic the *anti-Zcash* sign-in pattern. We're authenticating with the legacy path, not the privacy-preserving one.

The memo-challenge approach pivots to what Zcash actually does well: shielded transactions with memos. It's the same pattern [zcashnames](https://zcashnames.com) uses for registration — and it works in every wallet that can send a payment, which is every wallet ever built.

## How it works

1. **App issues a challenge.** Server generates a unique-amount challenge encoded in a [ZIP 321](https://zips.z.cash/zip-0321) payment-request URI. The amount carries entropy in its least-significant zatoshi digits — random per attempt.
2. **App displays a QR + `zcash:` deep link.** Wallets that support ZIP 321 (Zashi, YWallet, Zingo, eZcash, Zenith, …) open with the transaction pre-filled when the user scans/clicks.
3. **User sends the payment** from whichever wallet they want to authenticate as. The send is a regular shielded payment — no special UI needed in the wallet.
4. **App verifies the tx.** The server (or the user, via paste-txid) looks up the tx on a public block explorer and confirms one of its transparent outputs pays the expected `(serviceAddress, amount)` pair. Match ⇒ authenticated.

## Wire format

The ZIP 321 URI we generate:

```
zcash:t1QzwK7oMTdr4XF32s5RAtK9Eq45NFtdSbo?amount=0.06448145&label=ZBooks&message=Sign+in+to+ZBooks
```

The challenge token (HMAC-signed; round-trips client ↔ server statelessly):

```
base64url({v:1, to:<serviceAddress>, z:<amountZatoshi>, id:<claimedIdentity>, exp:<msSinceEpoch>}) "." HMAC-SHA256
```

Verification request:

```
POST /api/auth/memo/verify
{ "token": "<from issue>", "txid": "<64 hex chars>" }
```

The verifier looks up the txid via the configured `Explorer` implementation, iterates outputs, and accepts if any output's `(address, amount)` matches the token's `(to, z)`.

## Threat model

| | Memo-challenge | SIWZ-classic | Snap (permission) |
|---|---|---|---|
| Proves spending key ownership? | No — proves *spend authority over some ZEC* | Yes (cryptographic signature) | No — MetaMask approval grant |
| Wallet support today | **100%** (every shielded wallet) | <20% (zcash-cli, YWallet) | 1 wallet (when allowlist permits) |
| Privacy of the auth itself | High (shielded tx, sender hidden) | Low (transparent address & key on the wire) | High (MetaMask-mediated) |
| Cost to the user | One tx fee (~0.00001 ZEC) | Free | Free |
| Latency | ~75s (block confirm) | Instant | Instant |
| Sybil resistance | High (real ZEC required) | None | None |

The honest summary: memo-challenge gives weaker cryptographic ownership proof than SIWZ-classic (the sender of a shielded tx is hidden — we only know "someone with funds did this"), but vastly broader wallet support and built-in Sybil resistance. For most use cases (login to a dApp, register an account, vote in a DAO) that's the right trade.

To bind a *specific* identity to the session, the app supplies the identity (e.g. the user's UFVK, an email, an internal ID) when issuing the challenge. The verifier remembers `(amount → identity)` and authenticates that identity when the matching tx arrives.

## Operational considerations

### Service address: transparent vs shielded vs UA

**Transparent (`t1…`) — default.**
- Block explorers can read the recipient address and amount without any viewing key, so verification works with zero infra.
- Service address visibility is a privacy cost to the *service*, not to users (users still send from shielded wallets — their sender stays hidden).
- **You must control the spending key.** Funds sent for sign-ins are yours; lose the key, lose the funds. Use `scripts/gen-service-address.mjs` to generate one safely.
- Never use an address whose private key is in your source repo (or anywhere else public). The server in `apps/demo` has a hard-coded refusal-list for known-leaked test addresses.

**Shielded (`zs…`, `u1…`).**
- Privacy-maximalist option: the service address never appears on-chain in a publicly-decryptable form. Memo + amount are encrypted to the receiver.
- Requires running lightwalletd and holding the Incoming Viewing Key server-side to decrypt incoming memos.
- The verifier hook in `apps/demo/src/lib/explorer.ts` is pluggable — drop in a `LightwalletdExplorer` that uses the IVK and you can support shielded service addresses without changes to the protocol code.

**Unified addresses (`u1…`) as service address?** ZIP 321 lets you target a UA, but most wallets will send to the *shielded receiver* (sapling/orchard) inside the UA, not the transparent one. That payment is invisible to a transparent-output-scanning verifier. If you put a UA as `SIWZ_SERVICE_ADDRESS`, expect sign-ins to silently fail unless you've also wired up shielded verification. For hackathon scope: stick with `t1…`.

### Why amount-encoded nonces and not memos?

A transparent service address can't see memos (memos are a shielded-only construct). To carry the per-attempt entropy on a transparent service address we encode the nonce in the *amount* — the random 24-bit suffix gives ~16M concurrent challenges before collision becomes notable, well above any realistic concurrent-sign-in rate.

If you migrate to a shielded service address, the memo can carry the nonce directly and the amount can be fixed (e.g. dust). The `@siwz/core` `issueMemoChallenge` API is shaped to support both — only the `Explorer` implementation needs to change.

### Replay & one-shot semantics

The HMAC token binds (recipient, amount, identity, expiry). Within the TTL, anyone who observes the token *plus* a matching on-chain tx can call verify and get an envelope. To make verification one-shot, the app should keep a "consumed txid" set (Redis, DB, in-memory). For ZBooks, NextAuth's `signIn` is itself one-shot (creates one session per call), so we don't separately enforce one-shot at the verify layer.

### DEMO mode

`SIWZ_DEMO=1` swaps the live block explorer for an in-memory `MockExplorer`. The `/api/auth/memo/issue` endpoint then auto-seeds a synthetic txid that satisfies the freshly-issued challenge — the user (or e2e script) just clicks "use" to paste it. Useful for judging without spending ZEC.

## Forward-looking: ZSAs

[ZIP 226](https://zips.z.cash/zip-0226) / [227](https://zips.z.cash/zip-0227) (Zcash Shielded Assets) open a different identity model: issue a non-transferable ZSA as a team-membership token. The wallet holding the token *is* the team member. Auth becomes "does the wallet hold the right ZSA?" — no signature, no payment, no challenge round-trip.

That's a v2 story. ZSAs are NU6+ and wallet support is still landing. Until that's stable, memo-challenge is the right pragmatic answer.
