# Wallet integration

How users actually sign a SIWZ challenge in each major Zcash wallet today.

## Why is this paste-based?

SIWZ uses the standard Zcash `signmessage` wire format (magic prefix `"Zcash Signed Message:\n"`), so any wallet that already exposes "Sign Message" works. What does NOT exist yet — for any Zcash wallet — is a browser-to-wallet URI scheme like `zcash:sign?challenge=…` that would let a website pop the user's wallet open automatically (the way WalletConnect does for Ethereum). Until wallets ship that, paste is the universal lowest common denominator. The flow is:

1. App displays the SIWZ challenge.
2. User opens their wallet, finds **Sign Message**, pastes the address + challenge.
3. Wallet returns a base64 signature.
4. User pastes that back into the app.

When a wallet ships a SIWZ-aware URI handler, `@siwz/react` will auto-detect it and skip steps 2-4.

## Transparent (`t1…`) addresses

### `zcashd` / `zcash-cli`

```bash
zcash-cli signmessage "t1Mzhr3kuvJZptZsHWErxXEpVAyrgyngFmK" "<paste full SIWZ message>"
```

Returns a base64 signature. Paste that into the SIWZ component's signature field.

### Zodl

Look for **Sign Message** in the wallet menu (the exact path moves between versions — recent builds expose it under wallet settings or an advanced tools section). Paste the address and SIWZ challenge; copy out the resulting signature.

### Zingo (desktop)

Tools → Sign / Verify Message → enter the address, paste the challenge, copy the produced signature.

### YWallet (desktop / mobile)

Account menu → Sign Message → select the transparent receiver, paste the challenge.

### ZecWallet Lite

Address book → context menu on the transparent address → Sign Message.

## Shielded (`zs…`, Sapling) addresses

[ZIP 304](https://zips.z.cash/zip-0304) defines the Sapling sign-message scheme. As of mid-2026, support is uneven across wallets:

| Wallet | ZIP 304 support |
|---|---|
| `zcashd` / `zcash-cli` (`z_signmessage`) | Reference implementation |
| YWallet | Yes (via menu) |
| Others | Use the memo-challenge fallback below |

### Memo-challenge fallback (works in every shielded wallet)

For wallets that don't implement ZIP 304, ownership can be proven by sending a tiny shielded transaction with the SIWZ nonce in the memo to a service address you control:

1. App displays a service address and a unique memo (e.g. `siwz:<nonce>:<claimed-address>`).
2. User sends 0.00000001 ZEC (or 0) with that memo from the address they're claiming.
3. App's verifier service uses an incoming viewing key to decrypt the memo, confirms the nonce matches, and treats the claim as authenticated.

This proves the user *had spend authority* over the claimed address. It does not prove the address is theirs in the cryptographic sense ZIP 304 does — it could be a wallet they once had access to — but for most application threat models it's plenty.

The memo path is not built into `@siwz/core` because it requires a lightwalletd connection and an incoming viewing key. We may add a `@siwz/memo-challenge` package in a future release.

## Unified (`u1…`) addresses

Unified addresses contain one or more receivers (P2PKH, Sapling, Orchard). Today, there is no canonical "sign as this UA" operation — instead, the user signs with one of the receivers inside their UA, and the application displays the UA as the visible identity.

Most wallets that hold a UA will let the user pick a receiver to sign with. SIWZ accepts a UA in the address field and the wallet's `signmessage` UI will return a signature against whichever receiver it picks.

## I'm a wallet developer — how do I add SIWZ support?

You don't need to. As long as your wallet already supports `signmessage` against a transparent address (using the standard Zcash magic prefix `"Zcash Signed Message:\n"`), your users can sign SIWZ challenges today.

If you want a smoother UX:

- Detect when the user pastes a SIWZ-formatted message (look for the header line `<domain> wants you to sign in with your Zcash account:` and let them sign in one click.
- Display the `domain`, `URI`, and `statement` prominently in your signing UI so users know what they're authorizing.
- For shielded receivers, implement ZIP 304 — it's the standards-track path.
