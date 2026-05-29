# SIWZ Security Model

What SIWZ guarantees, what it doesn't, and what you need to do at the application layer.

## What's protected by the protocol

| Threat | Mitigation |
|---|---|
| Signature replay across sessions | Server-issued nonces, checked on every verify. Stateless HMAC tokens included. |
| Signature replay across apps | Message includes `domain`; verifier rejects if it doesn't match. |
| Signature replay across networks | Message includes `Network`; verifier requires it match the address encoding. |
| Signature replay across the Zcash↔Bitcoin universe | Magic prefix is `"Zcash Signed Message:\n"` (not Bitcoin's), so signatures don't cross-validate. |
| Expired sessions reaching the server | `Expiration Time` is enforced; nonce HMAC also has its own TTL. |
| Timing oracles in nonce verification | `crypto.timingSafeEqual` on the HMAC compare. |
| Tampering with the message after signing | dsha256-then-secp256k1; any byte change breaks verification. |
| Tampering with the address after signing | Address is part of the signed message and HASH160 must match recovered pubkey. |

## What's NOT protected by the protocol

These are application-layer concerns. SIWZ does not address them; you must.

### XSS

A SIWZ session cookie is no more or less resistant to XSS than any other auth cookie. Use NextAuth's HttpOnly cookies (default), set CSP, sanitize user-rendered content.

### CSRF on the credentials endpoint

NextAuth includes CSRF protection on `/api/auth/callback/*`. Don't disable it.

### Wallet UX phishing

If a malicious site can get a user to sign a SIWZ message *for* `legit-app.com` while they think they're signing in *to* `evil.com`, the protocol cannot help. Wallets SHOULD render the `domain` field prominently before signing.

### Address rotation

A user has no canonical Zcash identity: they can hold thousands of addresses, and shielded users SHOULD rotate. Your application needs to decide whether the user's identity is "this specific address" (simple) or "anyone who can sign with any address in this set" (more complex; typically a one-time linking step at sign-up).

### Sybil

A user can have unlimited addresses. SIWZ does not solve Sybil. Pair it with rate limiting, proof-of-payment, or off-chain reputation for use cases where one-account-per-human matters.

### Private-key custody

SIWZ never sees a private key, but if the user pastes their seed into a phishing site to "import their wallet", we cannot help. Wallets SHOULD be the only thing that ever touches a spending key.

## Operational guidance

- **Always set `NEXTAUTH_SECRET` to a strong random value.** Reused as the SIWZ nonce HMAC key.
- **Use HTTPS in production.** SIWZ doesn't bind to TLS the way some browser APIs do; a MITM that can intercept the nonce + the signature *and* an existing browser session can replay both. Standard hygiene.
- **Rate-limit `/api/siwz/nonce`.** It's cheap, but unauthenticated; trivially abusable for DoS amplification.
- **Set short `expirationSeconds`.** 10 minutes is the default. That's the window in which a stolen signature could be replayed before the nonce expires. Lower it if your threat model warrants.
- **Log verification failures with the error code** (`VERIFIER_UNAVAILABLE`, `EXPIRED`, `DOMAIN_MISMATCH`, …). They're often the first signal of an attack.

## Threat model: a stolen signature

Suppose an attacker captures a valid `(message, signature, nonceToken)` triple in flight:

- **Same session:** they can replay it once. They will end up signed in as the legitimate user. Mitigation: TLS.
- **After the user signs in:** the nonceToken is single-use only if the application enforces single-use (the default `verifyNonceToken` does NOT; it only checks the HMAC and TTL). For higher assurance, layer a `nonce_consumed` Bloom filter or a one-shot cache on top.
- **After TTL expiry:** the nonceToken fails verification, the signature alone is useless without a fresh nonce.

We chose stateless nonces as the default because they remove the operational burden in serverless deploys. For applications where single-use enforcement is critical, wrap `verifyNonceToken` in a `consumed` check backed by Redis or your DB.
