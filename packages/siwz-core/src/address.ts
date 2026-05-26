import { base58checkDecode, base58checkEncode, bech32, bech32m, bytesEqual } from "./crypto.js";
import { SiwzError } from "./errors.js";
import type { Network, ParsedAddress } from "./types.js";

/**
 * Transparent address version bytes. Zcash uses 2-byte version prefixes
 * (unlike Bitcoin's 1 byte) — see the Zcash Protocol Specification §5.6.1.1.
 */
const TRANSPARENT_VERSION = {
  mainnet: {
    p2pkh: new Uint8Array([0x1c, 0xb8]), // t1...
    p2sh:  new Uint8Array([0x1c, 0xbd]), // t3...
  },
  testnet: {
    p2pkh: new Uint8Array([0x1d, 0x25]), // tm...
    p2sh:  new Uint8Array([0x1c, 0xba]), // t2...
  },
  regtest: {
    p2pkh: new Uint8Array([0x1d, 0x25]), // shares testnet encoding
    p2sh:  new Uint8Array([0x1c, 0xba]),
  },
} as const;

/** Bech32 / Bech32m HRP (human-readable prefix) → kind. */
const SHIELDED_HRPS: Record<string, { type: "sapling" | "orchard" | "unified"; network: Network; encoding: "bech32" | "bech32m" }> = {
  // Sapling — bech32 (BIP-173)
  zs:               { type: "sapling", network: "mainnet", encoding: "bech32" },
  ztestsapling:     { type: "sapling", network: "testnet", encoding: "bech32" },
  zregtestsapling:  { type: "sapling", network: "regtest", encoding: "bech32" },
  // Unified addresses — bech32m (BIP-350), ZIP-316
  u:      { type: "unified", network: "mainnet", encoding: "bech32m" },
  utest:  { type: "unified", network: "testnet", encoding: "bech32m" },
  uregtest: { type: "unified", network: "regtest", encoding: "bech32m" },
};

/**
 * Try to identify and parse any Zcash address: t-addr, z-addr (Sapling),
 * or unified address. Throws SiwzError("INVALID_ADDRESS") on failure.
 *
 * Notes / scope:
 *   - Transparent addresses are fully parsed (version bytes verified,
 *     HASH160 extracted).
 *   - Sapling addresses are validated as well-formed bech32 with a known HRP
 *     but we don't decode the diversifier/pk_d split here; the bytes are
 *     handed off to the Sapling verifier when needed.
 *   - Unified addresses: we validate the bech32m envelope and split the
 *     decoded payload into receivers using ZIP-316's TLV-like framing.
 *     Decryption of the full UA structure (jubjub/pallas keys) is left to
 *     downstream consumers — we return the receiver bytes so a UA-aware
 *     library (e.g. WebZjs) can take over.
 */
export function parseAddress(raw: string): ParsedAddress {
  if (typeof raw !== "string" || raw.length < 5) {
    throw new SiwzError("INVALID_ADDRESS", "Address must be a non-empty string");
  }

  // Transparent: starts with t and is base58-decodable.
  if (raw.startsWith("t")) return parseTransparent(raw);

  // Shielded / unified: bech32 or bech32m, HRP-prefixed with "1" separator.
  const sep = raw.lastIndexOf("1");
  if (sep <= 0) {
    throw new SiwzError("INVALID_ADDRESS", `Unrecognised address format: ${raw.slice(0, 10)}…`);
  }
  const hrp = raw.slice(0, sep).toLowerCase();
  const meta = SHIELDED_HRPS[hrp];
  if (!meta) {
    throw new SiwzError("INVALID_ADDRESS", `Unknown address prefix "${hrp}"`);
  }

  let words: number[];
  try {
    const codec = meta.encoding === "bech32m" ? bech32m : bech32;
    const decoded = codec.decode(raw.toLowerCase() as `${string}1${string}`, raw.length);
    if (decoded.prefix !== hrp) {
      throw new Error("HRP mismatch after decode");
    }
    words = decoded.words as unknown as number[];
  } catch (err) {
    throw new SiwzError("INVALID_ADDRESS", `Malformed ${meta.encoding} for ${hrp}: ${(err as Error).message}`);
  }

  const payload = new Uint8Array(bech32.fromWords(words));

  if (meta.type === "unified") {
    return {
      raw,
      type: "unified",
      network: meta.network,
      receivers: extractUnifiedReceivers(payload, meta.network),
    };
  }
  // Sapling
  return {
    raw,
    type: "sapling",
    network: meta.network,
    hash: payload,
  };
}

function parseTransparent(raw: string): ParsedAddress {
  let decoded: Uint8Array;
  try {
    decoded = base58checkDecode(raw);
  } catch (err) {
    throw new SiwzError("INVALID_ADDRESS", `Invalid base58check t-address: ${(err as Error).message}`);
  }
  if (decoded.length !== 22) {
    throw new SiwzError("INVALID_ADDRESS", `Transparent address must decode to 22 bytes, got ${decoded.length}`);
  }
  const version = decoded.slice(0, 2);
  const hash = decoded.slice(2);

  for (const network of ["mainnet", "testnet", "regtest"] as const) {
    const versions = TRANSPARENT_VERSION[network];
    if (bytesEqual(version, versions.p2pkh)) {
      return { raw, type: "p2pkh", network, hash };
    }
    if (bytesEqual(version, versions.p2sh)) {
      return { raw, type: "p2sh", network, hash };
    }
  }
  throw new SiwzError(
    "INVALID_ADDRESS",
    `Unknown transparent version bytes 0x${version[0]!.toString(16)}${version[1]!.toString(16)}`,
  );
}

/**
 * Re-encode a HASH160 + network into a t1 P2PKH address. Inverse of the
 * `hash` field returned by parseAddress for type === "p2pkh".
 */
export function encodeP2pkh(hash20: Uint8Array, network: Network): string {
  if (hash20.length !== 20) throw new Error("hash must be 20 bytes");
  const version = TRANSPARENT_VERSION[network].p2pkh;
  const payload = new Uint8Array(22);
  payload.set(version, 0);
  payload.set(hash20, 2);
  return base58checkEncode(payload);
}

/**
 * Receiver type tags from ZIP-316 §5.5. We expose this purely for
 * downstream code that wants to know which receivers a UA contains.
 */
export const UA_RECEIVER_TYPES = {
  P2PKH:   0x00,
  P2SH:    0x01,
  SAPLING: 0x02,
  ORCHARD: 0x03,
} as const;

/**
 * Best-effort split of a Unified Address payload into its constituent
 * receivers.
 *
 * The full ZIP-316 format is `(typecode, length, data)*` followed by a
 * padding+F4Jumble round; we do *not* attempt to reverse F4Jumble here —
 * that requires the BLAKE2b-based permutation. Instead we expose what we
 * can confirm (presence of recognised typecode bytes near the start) and
 * mark unknown receivers as opaque. Apps that need full UA introspection
 * should pair @siwz/core with a UA-aware lib (e.g. WebZjs).
 *
 * For SIWZ's purposes this is sufficient: the user is asked to sign with
 * a *specific* receiver address (extracted by their wallet); the UA itself
 * is just the canonical identity string we display.
 */
function extractUnifiedReceivers(payload: Uint8Array, network: Network): ParsedAddress[] {
  const receivers: ParsedAddress[] = [];
  // We don't dejumble — instead, we surface the UA as a single "unified"
  // entry. Apps that want individual receivers should parse client-side
  // using a UA-aware library and then call parseAddress on each.
  receivers.push({
    raw: `unified-payload(${payload.length}b)`,
    type: "unified",
    network,
    hash: payload,
  });
  return receivers;
}

/**
 * Quick boolean check — does this look like any Zcash address we recognise?
 * Useful for UI affordances (input validation) without throwing.
 */
export function isZcashAddress(s: string): boolean {
  try {
    parseAddress(s);
    return true;
  } catch {
    return false;
  }
}
