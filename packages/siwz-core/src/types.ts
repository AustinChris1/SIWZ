/**
 * Zcash network identifier. Mirrors the on-chain "network" concept used in
 * Zcash address encodings rather than borrowing the EVM "chain id" term —
 * Zcash has no notion of a chain id.
 */
export type Network = "mainnet" | "testnet" | "regtest";

/**
 * The kind of Zcash address. SIWZ supports proving ownership of any of these,
 * though the cryptographic path differs per type (see `verify` module).
 */
export type AddressType =
  | "p2pkh"      // transparent t-addr (t1... mainnet, tm... testnet)
  | "p2sh"       // transparent script t-addr (t3..., t2...)
  | "sapling"    // shielded z-addr (zs..., ztestsapling...)
  | "orchard"    // orchard receiver (typically only in unified addresses)
  | "unified";   // unified address (u1..., utest1...)

export interface ParsedAddress {
  /** The original address string the user provided. */
  raw: string;
  /** Address kind. */
  type: AddressType;
  /** Network this address belongs to. */
  network: Network;
  /**
   * For transparent (p2pkh/p2sh), the 20-byte HASH160 of pubkey or script.
   * For shielded, the raw decoded data (semantics vary by type).
   * For unified, undefined — see `receivers` instead.
   */
  hash?: Uint8Array;
  /**
   * For unified addresses, the list of contained receivers, each a parsed
   * address of one of the simpler types.
   */
  receivers?: ParsedAddress[];
}

/**
 * Fields of a SIWZ message. The on-wire string form is produced by
 * `SiwzMessage#toString()` and parsed back by `SiwzMessage.parse()`.
 *
 * The format is intentionally modeled on EIP-4361 ("Sign-In with Ethereum")
 * so that developers familiar with SIWE recognise it instantly. The two
 * material differences from SIWE are:
 *   1. "Network:" replaces "Chain ID:" — Zcash has no chain id.
 *   2. "Address:" can be a transparent, shielded, or unified address; the
 *      verification path is dispatched based on the address type.
 */
export interface SiwzFields {
  /** The domain requesting the sign-in (RFC 4501 dnsauthority). */
  domain: string;
  /** The Zcash address the user is signing in with. */
  address: string;
  /** Human-readable assertion the user signs. Optional but recommended. */
  statement?: string;
  /** RFC 3986 URI referring to the resource that is the subject of signing. */
  uri: string;
  /** Current version of the SIWZ message format. Must be "1". */
  version: "1";
  /** Zcash network. */
  network: Network;
  /** Random nonce (>= 8 chars alphanumeric) to prevent replay. */
  nonce: string;
  /** ISO 8601 timestamp when the message was issued. */
  issuedAt: string;
  /** Optional ISO 8601 timestamp after which the signature is invalid. */
  expirationTime?: string;
  /** Optional ISO 8601 timestamp before which the signature is invalid. */
  notBefore?: string;
  /** Optional system-specific identifier. */
  requestId?: string;
  /** Optional list of RFC 3986 URIs the user authorises. */
  resources?: string[];
}

export interface VerifyResult {
  /** Whether the signature is cryptographically valid for the given address+message. */
  valid: boolean;
  /** The address that signed (echoed from input on success). */
  address?: string;
  /** Address type that was verified. */
  addressType?: AddressType;
  /** Error code if verification failed. */
  error?: SiwzErrorCode;
  /** Human-readable error detail. */
  errorMessage?: string;
}

export type SiwzErrorCode =
  | "INVALID_MESSAGE"
  | "INVALID_ADDRESS"
  | "INVALID_SIGNATURE"
  | "ADDRESS_MISMATCH"
  | "EXPIRED"
  | "NOT_YET_VALID"
  | "UNSUPPORTED_ADDRESS_TYPE"
  | "NETWORK_MISMATCH"
  | "NONCE_MISMATCH"
  | "DOMAIN_MISMATCH"
  | "VERIFIER_UNAVAILABLE";
