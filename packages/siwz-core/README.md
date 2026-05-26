# `@siwz/core`

Core protocol primitives for Sign in with Zcash. Zero React / Next.js / framework deps — works in Node, browsers, and edge runtimes.

## Install

```bash
npm i @siwz/core
```

## What's in here

| Symbol | What it does |
|---|---|
| `SiwzMessage` | Build and parse the canonical SIWZ wire format. |
| `generateNonce` | Cryptographically-random alphanumeric nonces. |
| `parseAddress` | Detect and decode any Zcash address (t / z / u). |
| `isZcashAddress` | Boolean form of `parseAddress` for UI affordances. |
| `verifyMessage` | High-level dispatcher: parses, checks integrity, verifies signature. |
| `verifyTransparentSignature` | Low-level: P2PKH ECDSA-recovery verify. |
| `verifySaplingSignature` | Stub that delegates to a pluggable ZIP 304 verifier. |

## Wire format

Closely models EIP-4361 (SIWE). The two intentional differences:

1. `Network:` replaces `Chain ID:` — Zcash has no chain id.
2. `Address:` may be transparent (`t1…`), Sapling shielded (`zs…`), or Unified (`u1…`). The verifier dispatches the right algorithm.

```
example.com wants you to sign in with your Zcash account:
t1Mzhr3kuvJZptZsHWErxXEpVAyrgyngFmK

I accept the ToS at https://example.com/tos

URI: https://example.com/login
Version: 1
Network: mainnet
Nonce: abc12345xyz
Issued At: 2026-05-25T10:00:00Z
Expiration Time: 2026-05-25T11:00:00Z
```

## Build and parse

```ts
import { SiwzMessage, generateNonce } from "@siwz/core";

const msg = new SiwzMessage({
  domain: "myapp.com",
  address: "t1Mzhr3kuvJZptZsHWErxXEpVAyrgyngFmK",
  uri: "https://myapp.com/login",
  network: "mainnet",
  nonce: generateNonce(),
  issuedAt: new Date().toISOString(),
  expirationTime: new Date(Date.now() + 600_000).toISOString(),
  statement: "Sign in to my dApp.",
});

const wire = msg.toString();         // canonical string form
const parsed = SiwzMessage.parse(wire); // round-trips losslessly
```

## Verify

```ts
import { verifyMessage } from "@siwz/core";

const result = await verifyMessage(wire, signatureBase64, {
  expectedDomain: "myapp.com",
  expectedNonce: theNonceYouIssued,
});

if (result.valid) {
  console.log(`signed in as ${result.address}`);
} else {
  console.warn(`rejected: ${result.error} – ${result.errorMessage}`);
}
```

## Transparent (t-addr) verification

`verifyTransparentSignature` implements the Zcash `signmessage` wire format:

- **Magic prefix:** `"Zcash Signed Message:\n"` (the constant from `zcashd/src/main.cpp`).
- **Hash:** `dsha256(varint(magic.len) || magic || varint(msg.len) || msg)`.
- **Signature:** 65 bytes: `recoveryByte || r (32) || s (32)`.
- **`recoveryByte`:** `27 + recovery_id + (compressed ? 4 : 0)`.
- **Algorithm:** recover the secp256k1 public key from `(r, s, recovery, hash)`, serialize per the compressed flag, then `HASH160(pubkey) == address.hash`.

This is identical to Bitcoin's `signmessage` other than the magic prefix, which is what makes every Zcash wallet's existing signmessage UX produce SIWZ-compatible signatures.

## Shielded (Sapling z-addr) verification

[ZIP 304](https://zips.z.cash/zip-0304) defines Sapling signed messages. Verifying one requires the Sapling Spend authorization circuit, which is not yet practical to implement in pure JS at hackathon scope.

The `verifySaplingSignature` function therefore takes an optional `saplingVerifier` callback. Pass in a wrapper around a WASM build of `librustzcash` (see [docs/sapling-wasm.md](../../docs/sapling-wasm.md)) and SIWZ will dispatch z-addr sign-ins to it.

## Tests

```bash
pnpm --filter @siwz/core test
```

26 tests covering message build/parse round-trip, address decoding (t1/tm/t3/checksum validation), and signature verify (compressed + uncompressed pubkeys, mismatched messages/addresses, expired messages, domain/nonce mismatches).
