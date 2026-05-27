import { parseAddress } from "./address.js";
import { buildZip321, zecToZatoshi } from "./zip321.js";
import { SiwzError } from "./errors.js";
import type { Network } from "./types.js";

/**
 * Memo string format used in shielded-memo mode. The body after the
 * prefix is the per-challenge nonce (12 random alphanumeric chars from
 * the challenge token). Wallet UIs show this verbatim to the user.
 */
const MEMO_PREFIX = "SIWZ:";

function formatMemo(nonce: string): string {
  return `${MEMO_PREFIX}${nonce}`;
}

function extractNonce(memo: string): string | null {
  if (!memo.startsWith(MEMO_PREFIX)) return null;
  return memo.slice(MEMO_PREFIX.length);
}

export type MemoChallengeMode = "transparent-amount" | "shielded-memo";

function inferMode(serviceAddress: string): MemoChallengeMode {
  const parsed = parseAddress(serviceAddress);
  return parsed.type === "p2pkh" || parsed.type === "p2sh" ? "transparent-amount" : "shielded-memo";
}

/**
 * SIWZ memo-challenge — the Zcash-native sign-in flow.
 *
 * Idea: instead of asking the user to sign a message (which most Zcash
 * wallets don't expose), we ask them to send a tiny on-chain payment.
 * The payment proves spend authority over some ZEC. Same anti-Sybil
 * property zcashnames uses. Works with every wallet that implements
 * ZIP 321 — i.e., every shielded wallet on the market.
 *
 * Two operational modes:
 *
 *   A. SHIELDED service address + memo encoded in the shielded memo
 *      field. Server needs an Incoming Viewing Key + lightwalletd to
 *      decrypt incoming memos. Strongest privacy, most infra.
 *
 *   B. TRANSPARENT service address + unique-amount challenge. The
 *      challenge nonce is encoded in the last few decimals of the
 *      ZEC amount (e.g. 0.00001337 means session "1337"). Server
 *      polls any public block explorer for incoming txs to the
 *      service address; matching amount = matching session. No
 *      lightwalletd, no IVK management. Service address is publicly
 *      visible on-chain; that's a privacy cost for the *service*, not
 *      for end users who still send from their shielded wallets.
 *
 * This module implements mode B — chosen for ship-fast pragmatics.
 * Mode A is documented but not built in @siwz/core; integrators with
 * IVK infrastructure can drop in their own verifier.
 *
 * Challenge format (mode B):
 *   amount = baseAmount + nonceValue/10^precision
 *   where baseAmount is fixed (e.g. 0.0001 ZEC) and nonceValue is a
 *   server-issued 32-bit unique integer encoded in zatoshi precision.
 *
 * To keep the implementation honest and replay-proof:
 *   - Challenges are stateless: a signed token binds {amount, identity,
 *     expiresAt} via HMAC. Server only stores "consumed" set if it
 *     wants one-shot semantics.
 *   - On detection of an incoming tx with the matching amount, the
 *     server marks the challenge consumed and authenticates the
 *     associated identity.
 */

export interface IssueMemoChallengeOpts {
  /** Server's HMAC secret (typically NEXTAUTH_SECRET). */
  secret: string;
  /**
   * Service address that receives the proof tx. May be transparent
   * (`t1…`), sapling (`zs…`), or unified (`u1…`). The challenge dispatcher
   * picks the verification mode automatically based on the address type:
   *   - Transparent → unique-amount challenge (verifier sees the amount
   *     publicly on chain).
   *   - Shielded (Sapling / Unified) → memo-encoded challenge (verifier
   *     decrypts incoming memos with its IVK and matches the nonce).
   */
  serviceAddress: string;
  /** Network. */
  network: Network;
  /**
   * Force a specific mode regardless of address type. Useful for tests.
   * Defaults to auto-detection from the address.
   */
  mode?: MemoChallengeMode;
  /**
   * Base amount in ZEC. The unique nonce (4 decimal digits, 0..9999) is
   * added on top in zatoshi. Default 0.0001 ZEC so amounts land in the
   * range 0.0001..0.00019999 ZEC (about $0.06 to $0.12 at typical
   * mainnet prices — small enough to be visibly a "fee", large enough
   * to clear the 0.00001 ZEC default minimum for many wallets).
   */
  baseAmountZec?: string;
  /** TTL of the challenge in seconds. Default 600 (10 min). */
  ttlSeconds?: number;
  /**
   * The identity the resulting session should be bound to. Optional.
   * Application-defined string — for ZBooks we use the user's claimed
   * UFVK when available, or a server-generated anonymous session ID
   * when not. Leaving this empty/undefined produces an anonymous
   * challenge whose session has no persistent identity binding (the
   * user can later attach a UFVK to recover the account from another
   * device, but they don't have to do anything upfront).
   */
  identity?: string;
  /** Optional free-text shown by the wallet on the payment screen. */
  message?: string;
  /** Optional short label shown by the wallet. */
  label?: string;
}

export interface MemoChallenge {
  /** Which verification mode this challenge is in. */
  mode: MemoChallengeMode;
  /** ZIP 321 URI to render as QR or `zcash:` deep link. */
  uri: string;
  /**
   * Amount in ZEC the user must send. For transparent-amount mode this
   * is the unique per-challenge amount; for shielded-memo mode it's
   * a fixed dust amount (the memo carries the nonce instead).
   */
  amountZec: string;
  /** Same amount in zatoshi. */
  amountZatoshi: string;
  /**
   * Memo the user must include in their tx (shielded-memo mode only).
   * The wallet will pre-fill this from the ZIP 321 URI's memo param.
   */
  memo?: string;
  /** Service address the tx must be sent to. */
  serviceAddress: string;
  /** Stateless token to round-trip back to verifyMemoChallenge. */
  token: string;
  /** When the challenge expires. */
  expiresAt: string;
}

export interface VerifyMemoChallengeOpts {
  secret: string;
  /** Token issued by issueMemoChallenge. */
  token: string;
  /**
   * Amount in zatoshi observed on-chain. Used for transparent-amount
   * mode verification; may be omitted for shielded-memo mode where
   * the memo carries the nonce.
   */
  observedAmountZatoshi?: bigint | string;
  /**
   * Memo decrypted from the shielded note. Required for shielded-memo
   * mode. May be omitted for transparent-amount mode.
   */
  observedMemo?: string;
  /** Address the on-chain tx paid to. Must match the service address in the token. */
  observedRecipient: string;
  now?: Date;
}

export interface VerifyMemoChallengeResult {
  ok: boolean;
  identity?: string;
  mode?: MemoChallengeMode;
  error?:
    | "MALFORMED_TOKEN"
    | "BAD_SIGNATURE"
    | "EXPIRED"
    | "AMOUNT_MISMATCH"
    | "MEMO_MISMATCH"
    | "MISSING_OBSERVATION"
    | "RECIPIENT_MISMATCH";
  errorMessage?: string;
}

interface ChallengePayload {
  v: 1;
  /** Which mode this challenge expects ("ta" = transparent-amount, "sm" = shielded-memo). */
  m: "ta" | "sm";
  /** Service address. */
  to: string;
  /**
   * Transparent-amount mode: expected amount in zatoshi (string).
   * Shielded-memo mode: still set to the fixed dust amount so the verifier
   * can sanity-check the observed note's value if it wants to (we don't
   * enforce by default — the memo is the binding artifact).
   */
  z: string;
  /** Shielded-memo mode: the expected memo body (after "SIWZ:" prefix). */
  n?: string;
  /** Identity to bind. */
  id: string;
  /** ms-since-epoch expiry. */
  exp: number;
}

/**
 * Issue a memo-challenge. Returns a stateless token that can later be
 * verified against an on-chain observation, plus all the data needed to
 * render the wallet-facing payment request.
 *
 * The amount is computed as:
 *   amount = baseAmount + nonceZatoshi
 * where nonceZatoshi is a random 4-decimal-digit integer (0..9999).
 * With base = 0.0001 ZEC, amounts land in 0.0001..0.00019999 ZEC —
 * about $0.06 to $0.12 at typical mainnet prices, easily readable on
 * a wallet's confirm screen, and well within "dust" sensibility for
 * a sign-in fee. 10,000 nonces over a 10-minute TTL is far more than
 * any realistic concurrent-sign-in rate; on the rare collision the
 * later challenge just re-rolls.
 */
export async function issueMemoChallenge(opts: IssueMemoChallengeOpts): Promise<MemoChallenge> {
  if (!opts.secret || opts.secret.length < 16) {
    throw new SiwzError("INVALID_MESSAGE", "issueMemoChallenge: secret must be ≥ 16 characters");
  }
  const mode: MemoChallengeMode = opts.mode ?? inferMode(opts.serviceAddress);

  const ttl = (opts.ttlSeconds ?? 600) * 1000;
  const expiresAtMs = Date.now() + ttl;
  const identity = opts.identity ?? `anon:${secureRandomU32().toString(16).padStart(8, "0")}${secureRandomU32().toString(16).padStart(8, "0")}`;

  if (mode === "transparent-amount") {
    const base = zecToZatoshi(opts.baseAmountZec ?? "0.0001");
    const nonceZatoshi = BigInt(secureRandomU32() % 10_000);
    const totalZatoshi = base + nonceZatoshi;
    const amountZec = formatZatoshi(totalZatoshi);

    const payload: ChallengePayload = {
      v: 1,
      m: "ta",
      to: opts.serviceAddress,
      z: totalZatoshi.toString(),
      id: identity,
      exp: expiresAtMs,
    };
    const token = await signPayload(opts.secret, payload);

    const uri = buildZip321({
      address: opts.serviceAddress,
      amount: amountZec,
      label: opts.label ?? "SIWZ sign-in",
      message: opts.message ?? "Send to authenticate. The amount is unique to this sign-in attempt.",
    });

    return {
      mode,
      uri,
      amountZec,
      amountZatoshi: totalZatoshi.toString(),
      serviceAddress: opts.serviceAddress,
      token,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  // shielded-memo mode
  const dust = zecToZatoshi(opts.baseAmountZec ?? "0.00001");
  // 12 random alphanumeric chars — ~70 bits entropy, plenty of uniqueness,
  // tiny memo footprint.
  const nonce = randomAlphanumeric(12);
  const memo = formatMemo(nonce);

  const payload: ChallengePayload = {
    v: 1,
    m: "sm",
    to: opts.serviceAddress,
    z: dust.toString(),
    n: nonce,
    id: identity,
    exp: expiresAtMs,
  };
  const token = await signPayload(opts.secret, payload);

  const uri = buildZip321({
    address: opts.serviceAddress,
    amount: formatZatoshi(dust),
    memo,
    label: opts.label ?? "SIWZ sign-in",
    message: opts.message ?? "Send to authenticate. The memo proves this sign-in is yours.",
  });

  return {
    mode,
    uri,
    amountZec: formatZatoshi(dust),
    amountZatoshi: dust.toString(),
    memo,
    serviceAddress: opts.serviceAddress,
    token,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

async function signPayload(secret: string, payload: ChallengePayload): Promise<string> {
  const payloadB64 = base64urlEncodeStr(JSON.stringify(payload));
  const sig = await hmacB64(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

const ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function randomAlphanumeric(len: number): string {
  const buf = new Uint8Array(len);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(buf);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { randomFillSync } = require("node:crypto");
    randomFillSync(buf);
  }
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHA[buf[i]! % ALPHA.length];
  return out;
}

export async function verifyMemoChallenge(opts: VerifyMemoChallengeOpts): Promise<VerifyMemoChallengeResult> {
  const parts = opts.token.split(".");
  if (parts.length !== 2) return failure("MALFORMED_TOKEN", "token must be 'payload.signature'");
  const [payloadB64, sig] = parts as [string, string];

  const expectedSig = await hmacB64(opts.secret, payloadB64);
  if (!constantTimeEq(sig, expectedSig)) return failure("BAD_SIGNATURE", "HMAC mismatch");

  let payload: ChallengePayload;
  try {
    payload = JSON.parse(base64urlDecodeStr(payloadB64)) as ChallengePayload;
  } catch {
    return failure("MALFORMED_TOKEN", "payload is not valid base64url JSON");
  }
  if (payload.v !== 1) return failure("MALFORMED_TOKEN", `unsupported version ${payload.v}`);

  const now = (opts.now ?? new Date()).getTime();
  if (payload.exp <= now) return failure("EXPIRED", `challenge expired at ${new Date(payload.exp).toISOString()}`);

  if (payload.to !== opts.observedRecipient) {
    return failure(
      "RECIPIENT_MISMATCH",
      `expected tx to ${payload.to} but observed payment to ${opts.observedRecipient}`,
    );
  }

  const mode: MemoChallengeMode = payload.m === "sm" ? "shielded-memo" : "transparent-amount";

  if (mode === "transparent-amount") {
    if (opts.observedAmountZatoshi == null) {
      return failure("MISSING_OBSERVATION", "transparent-amount mode requires observedAmountZatoshi");
    }
    const observed = typeof opts.observedAmountZatoshi === "string"
      ? BigInt(opts.observedAmountZatoshi)
      : opts.observedAmountZatoshi;
    if (payload.z !== observed.toString()) {
      return failure(
        "AMOUNT_MISMATCH",
        `expected amount ${payload.z} zatoshi but observed ${observed.toString()}`,
      );
    }
    return { ok: true, identity: payload.id, mode };
  }

  // shielded-memo mode
  if (!opts.observedMemo) {
    return failure("MISSING_OBSERVATION", "shielded-memo mode requires observedMemo");
  }
  const observedNonce = extractNonce(opts.observedMemo);
  if (!observedNonce) {
    return failure("MEMO_MISMATCH", `observed memo does not start with "${MEMO_PREFIX}"`);
  }
  if (observedNonce !== payload.n) {
    return failure(
      "MEMO_MISMATCH",
      `expected nonce "${payload.n}" but observed "${observedNonce}"`,
    );
  }
  return { ok: true, identity: payload.id, mode };
}

function failure(error: NonNullable<VerifyMemoChallengeResult["error"]>, message: string): VerifyMemoChallengeResult {
  return { ok: false, error, errorMessage: message };
}

/** Returns the address-type-appropriate mode for a given service address. */
export function inferMemoChallengeMode(serviceAddress: string): MemoChallengeMode {
  return inferMode(serviceAddress);
}

// ----- helpers -----

function formatZatoshi(z: bigint): string {
  const whole = z / 100_000_000n;
  const frac = z % 100_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

function secureRandomU32(): number {
  const buf = new Uint8Array(4);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(buf);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { randomFillSync } = require("node:crypto");
    randomFillSync(buf);
  }
  return new DataView(buf.buffer).getUint32(0, false);
}

function base64urlEncodeStr(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecodeStr(s: string): string {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  if (typeof atob === "function") {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, "base64").toString("utf8");
}

async function hmacB64(secret: string, payload: string): Promise<string> {
  // Prefer WebCrypto in browser/edge; fall back to node:crypto in Node.
  if (typeof globalThis.crypto?.subtle?.importKey === "function") {
    const enc = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(payload));
    const bytes = new Uint8Array(sig);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHmac } = require("node:crypto");
  const b64 = createHmac("sha256", secret).update(payload).digest("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
