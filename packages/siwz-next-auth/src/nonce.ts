import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Stateless, signed nonce tokens for SIWZ.
 *
 * Why stateless? A naive implementation stores `nonce → expiry` in memory or
 * a database; that works but is fiddly across multiple Node instances. By
 * signing the nonce + expiry with a server-side HMAC, we get the same
 * replay-prevention guarantee with zero shared state: any backend instance
 * with the same secret can verify a token issued by any other.
 *
 * Token format (URL-safe):  base64url(nonce) "." base64url(expiryMs) "." base64url(hmac)
 *
 * Verification checks both the HMAC and the expiry. The "nonce" stays
 * unguessable (16 random bytes) so a stolen but unexpired token only
 * authenticates whoever already signed for that specific nonce.
 */
export interface NonceTokenOptions {
  /** Symmetric secret. ≥ 32 bytes. Typically reuse NEXTAUTH_SECRET. */
  secret: string;
  /** Lifetime in seconds. Default: 600 (10 min). */
  ttlSeconds?: number;
}

const ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomNonce(): string {
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += ALPHA[bytes[i]! % ALPHA.length];
  return out;
}

function b64url(s: Buffer | string): string {
  const b = typeof s === "string" ? Buffer.from(s) : s;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad), "base64");
}

function sign(secret: string, payload: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export interface IssuedNonce {
  /** The opaque nonce to embed in the SIWZ message. */
  nonce: string;
  /** The signed token to round-trip back from the client. */
  token: string;
  /** When this nonce expires. */
  expiresAt: Date;
}

export function issueNonce(opts: NonceTokenOptions): IssuedNonce {
  const ttl = (opts.ttlSeconds ?? 600) * 1000;
  const nonce = randomNonce();
  const expiresAtMs = Date.now() + ttl;
  const payload = `${b64url(nonce)}.${b64url(String(expiresAtMs))}`;
  const sig = sign(opts.secret, payload);
  return {
    nonce,
    token: `${payload}.${sig}`,
    expiresAt: new Date(expiresAtMs),
  };
}

export interface VerifyNonceResult {
  ok: boolean;
  nonce?: string;
  error?: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED";
}

export function verifyNonceToken(token: string, opts: NonceTokenOptions): VerifyNonceResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, error: "MALFORMED" };
  const [nonceB64, expB64, sig] = parts as [string, string, string];
  const expected = sign(opts.secret, `${nonceB64}.${expB64}`);
  // Constant-time compare to thwart timing oracles.
  if (sig.length !== expected.length) return { ok: false, error: "BAD_SIGNATURE" };
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { ok: false, error: "BAD_SIGNATURE" };
  }
  const expiresAtMs = Number(b64urlDecode(expB64).toString());
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return { ok: false, error: "EXPIRED" };
  }
  return { ok: true, nonce: b64urlDecode(nonceB64).toString() };
}
