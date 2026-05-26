import { parseAddress } from "./address.js";
import { SiwzError } from "./errors.js";
import type { Network } from "./types.js";

/**
 * ZIP 321 — Payment Request URI format (https://zips.z.cash/zip-0321).
 *
 * Builds and parses `zcash:<address>?amount=…&memo=<base64url>&message=…`
 * URIs. Wallets that support ZIP 321 (Zashi, YWallet, Zingo, eZcash, …)
 * open with the transaction pre-filled when the user follows the URI or
 * scans a QR-encoded form of it.
 *
 * We support the single-recipient form here. Multi-recipient (`address.1`,
 * `address.2`, …) is in the spec but unused by SIWZ memo-challenge —
 * SIWZ only ever asks the user to send one tx.
 */

export interface ZIP321Request {
  /** Recipient address (transparent, sapling, or unified). */
  address: string;
  /**
   * Amount in ZEC as a decimal string (NOT zatoshi). E.g. "0.00001337".
   * Required by ZIP 321 for SIWZ memo-challenge use; technically optional
   * in the spec.
   */
  amount?: string;
  /**
   * Memo as a UTF-8 string. We'll base64url-encode it on the way out and
   * base64url-decode it on the way in. Max 512 bytes per ZIP 321.
   */
  memo?: string;
  /** Free-text label shown by the wallet (e.g. "ZBooks"). */
  label?: string;
  /** Free-text message shown by the wallet (e.g. "Sign in to ZBooks"). */
  message?: string;
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

function base64urlEncode(bytes: Uint8Array): string {
  // Same encoding as RFC 4648 §5 (URL-safe), no padding.
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/**
 * Build a ZIP 321 URI. Throws SiwzError on invalid input.
 *
 * Note on amount formatting: ZIP 321 requires non-negative decimal with
 * at most 8 fractional digits. We accept either a decimal string or a
 * number; numbers are stringified with 8-digit precision. The amount
 * MUST NOT carry a thousands separator, trailing whitespace, or unit
 * suffix.
 */
export function buildZip321(req: ZIP321Request): string {
  if (!req.address) throw new SiwzError("INVALID_ADDRESS", "ZIP 321: address required");
  // Validate the address parses — sapling/unified/transparent all OK.
  try {
    parseAddress(req.address);
  } catch (err) {
    throw new SiwzError("INVALID_ADDRESS", `ZIP 321: ${(err as Error).message}`);
  }

  const params = new URLSearchParams();
  if (req.amount !== undefined) {
    const amountStr = normaliseAmount(req.amount);
    params.set("amount", amountStr);
  }
  if (req.memo !== undefined) {
    const memoBytes = TEXT_ENCODER.encode(req.memo);
    if (memoBytes.length > 512) {
      throw new SiwzError("INVALID_MESSAGE", `ZIP 321: memo must be ≤ 512 bytes (got ${memoBytes.length})`);
    }
    params.set("memo", base64urlEncode(memoBytes));
  }
  if (req.label !== undefined) params.set("label", req.label);
  if (req.message !== undefined) params.set("message", req.message);

  const qs = params.toString();
  return qs ? `zcash:${req.address}?${qs}` : `zcash:${req.address}`;
}

/**
 * Parse a ZIP 321 URI. Throws on malformed input. Unknown query params
 * are preserved on a `.unknown` map but not enforced.
 */
export function parseZip321(uri: string): ZIP321Request & { unknown: Record<string, string> } {
  if (!uri.startsWith("zcash:")) {
    throw new SiwzError("INVALID_MESSAGE", "ZIP 321: URI must start with 'zcash:'");
  }
  const body = uri.slice("zcash:".length);
  const qIdx = body.indexOf("?");
  const address = qIdx === -1 ? body : body.slice(0, qIdx);
  const qs = qIdx === -1 ? "" : body.slice(qIdx + 1);
  // Validate the address.
  parseAddress(address);

  const params = new URLSearchParams(qs);
  const out: ZIP321Request & { unknown: Record<string, string> } = {
    address,
    unknown: {},
  };
  for (const [k, v] of params.entries()) {
    switch (k) {
      case "amount":
        out.amount = normaliseAmount(v);
        break;
      case "memo":
        try {
          out.memo = TEXT_DECODER.decode(base64urlDecode(v));
        } catch {
          throw new SiwzError("INVALID_MESSAGE", `ZIP 321: invalid base64url memo`);
        }
        break;
      case "label":
        out.label = v;
        break;
      case "message":
        out.message = v;
        break;
      default:
        out.unknown[k] = v;
    }
  }
  return out;
}

const AMOUNT_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/;

function normaliseAmount(raw: string | number): string {
  let s = typeof raw === "number" ? raw.toFixed(8) : String(raw).trim();
  // Strip trailing zeros after a decimal point, but leave at least one digit.
  if (s.includes(".")) {
    s = s.replace(/0+$/, "");
    if (s.endsWith(".")) s = s.slice(0, -1);
  }
  if (!AMOUNT_RE.test(s)) {
    throw new SiwzError("INVALID_MESSAGE", `ZIP 321: invalid amount "${raw}" (must be non-negative decimal, ≤ 8 frac digits)`);
  }
  return s;
}

/**
 * Convert a ZEC amount string to zatoshi (1 ZEC = 10^8 zatoshi).
 * Useful for comparing on-chain tx amounts byte-for-byte.
 */
export function zecToZatoshi(zec: string): bigint {
  const [whole, frac = ""] = zec.split(".");
  const fracPadded = (frac + "00000000").slice(0, 8);
  return BigInt(whole ?? "0") * 100_000_000n + BigInt(fracPadded);
}

/**
 * Convert zatoshi back to a normalized ZEC decimal string.
 */
export function zatoshiToZec(zatoshi: bigint | number): string {
  const z = typeof zatoshi === "bigint" ? zatoshi : BigInt(zatoshi);
  const whole = z / 100_000_000n;
  const frac = z % 100_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/**
 * Optional sanity check: does this address belong to the given network?
 * Useful when building a request that the user will execute against a
 * specific network — surfaces mistakes early.
 */
export function assertAddressNetwork(address: string, network: Network): void {
  const parsed = parseAddress(address);
  if (parsed.network !== network) {
    throw new SiwzError("NETWORK_MISMATCH", `Address is on ${parsed.network} but expected ${network}`);
  }
}
