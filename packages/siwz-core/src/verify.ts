import { secp256k1 } from "@noble/curves/secp256k1";
import { parseAddress } from "./address.js";
import { base64Decode, bytesEqual, hash160, magicHash } from "./crypto.js";
import { SiwzError } from "./errors.js";
import { SiwzMessage } from "./message.js";
import type { ParsedAddress, VerifyResult } from "./types.js";

export interface VerifyOptions {
  /**
   * Expected domain (e.g. "example.com:3000"). If provided, the message's
   * domain field must match — protects against cross-site replay.
   */
  expectedDomain?: string;
  /**
   * Expected nonce. If your app issued a one-time nonce to this client,
   * pass it here to ensure the user didn't replay an old signature.
   */
  expectedNonce?: string;
  /**
   * Override "now" for time-validity checks. Useful in tests.
   */
  now?: Date;
  /**
   * Optional ZIP 304 Sapling verifier. SIWZ ships without one by default
   * because pure-JS ZIP 304 verification is not yet practical; integrators
   * can plug in a WASM (librustzcash) or out-of-process verifier.
   *
   * The function receives the message string (NOT the dsha256 magicHash),
   * the raw signature bytes, and the parsed Sapling address. It should
   * resolve to true iff the signature is valid for that address.
   */
  saplingVerifier?: (args: {
    message: string;
    signature: Uint8Array;
    address: ParsedAddress;
  }) => Promise<boolean>;
}

/**
 * Verify a transparent (P2PKH) signed-message signature.
 *
 * Signature format (Bitcoin/Zcash signmessage convention):
 *   65 bytes: [recovery_byte] [r (32)] [s (32)]
 *   recovery_byte = 27 + recovery_id + (compressed ? 4 : 0)
 *
 * Algorithm:
 *   1. hash = dsha256(varint(magic.len) || magic || varint(msg.len) || msg)
 *      where magic = "Zcash Signed Message:\n"
 *   2. recover pubkey from (r, s, recovery_id) and hash
 *   3. serialise pubkey in compressed or uncompressed form per the flag
 *   4. compare HASH160(pubkey_bytes) to the address's HASH160
 */
export function verifyTransparentSignature(
  message: string,
  signatureBase64: string,
  address: string,
): VerifyResult {
  let parsed: ParsedAddress;
  try {
    parsed = parseAddress(address);
  } catch (err) {
    return failure("INVALID_ADDRESS", (err as Error).message);
  }
  if (parsed.type !== "p2pkh") {
    return failure(
      "UNSUPPORTED_ADDRESS_TYPE",
      `verifyTransparentSignature only supports P2PKH (t1.../tm...); got ${parsed.type}`,
    );
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64Decode(signatureBase64);
  } catch (err) {
    return failure("INVALID_SIGNATURE", `signature is not valid base64: ${(err as Error).message}`);
  }
  if (sigBytes.length !== 65) {
    return failure("INVALID_SIGNATURE", `signature must be 65 bytes, got ${sigBytes.length}`);
  }

  const recoveryByte = sigBytes[0]!;
  if (recoveryByte < 27 || recoveryByte > 34) {
    return failure("INVALID_SIGNATURE", `recovery byte out of range: ${recoveryByte}`);
  }
  const compressed = recoveryByte >= 31;
  const recId = (recoveryByte - 27) & 0x03;
  const rs = sigBytes.slice(1);

  const hash = magicHash(message);

  let pubBytes: Uint8Array;
  try {
    const sig = secp256k1.Signature.fromCompact(rs).addRecoveryBit(recId);
    const point = sig.recoverPublicKey(hash);
    pubBytes = point.toRawBytes(compressed);
  } catch (err) {
    return failure("INVALID_SIGNATURE", `pubkey recovery failed: ${(err as Error).message}`);
  }

  const recoveredHash = hash160(pubBytes);
  if (!parsed.hash || !bytesEqual(recoveredHash, parsed.hash)) {
    return failure("ADDRESS_MISMATCH", "signature does not match the provided address");
  }

  return {
    valid: true,
    address,
    addressType: "p2pkh",
  };
}

/**
 * Verify a Sapling signed-message signature per ZIP 304.
 *
 * NOTE: ZIP 304 verification requires the Sapling Spend authorization
 * circuit, which is impractical to implement in pure JS at hackathon
 * scope. Two integration paths:
 *
 *   (a) Pass a `saplingVerifier` callback to `verifyMessage` that wraps
 *       a WASM build of librustzcash. See docs/sapling-wasm.md for the
 *       recommended approach.
 *   (b) Use the "memo-challenge" fallback: have the user send a tiny
 *       (zero-value) shielded transaction containing the SIWZ nonce in
 *       the memo to a service address you control, then verify the
 *       memo arrived. This proves ownership of *some* shielded address,
 *       though not a specific one. See docs/memo-challenge.md.
 */
export async function verifySaplingSignature(
  message: string,
  signatureBase64: string,
  address: string,
  verifier?: VerifyOptions["saplingVerifier"],
): Promise<VerifyResult> {
  let parsed: ParsedAddress;
  try {
    parsed = parseAddress(address);
  } catch (err) {
    return failure("INVALID_ADDRESS", (err as Error).message);
  }
  if (parsed.type !== "sapling") {
    return failure(
      "UNSUPPORTED_ADDRESS_TYPE",
      `verifySaplingSignature only handles Sapling z-addresses; got ${parsed.type}`,
    );
  }
  if (!verifier) {
    return failure(
      "VERIFIER_UNAVAILABLE",
      "Sapling verification requires a ZIP 304 verifier — pass `saplingVerifier` to verifyMessage. See docs/sapling-wasm.md.",
    );
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64Decode(signatureBase64);
  } catch (err) {
    return failure("INVALID_SIGNATURE", `signature is not valid base64: ${(err as Error).message}`);
  }

  let ok: boolean;
  try {
    ok = await verifier({ message, signature: sigBytes, address: parsed });
  } catch (err) {
    return failure("INVALID_SIGNATURE", `Sapling verifier threw: ${(err as Error).message}`);
  }
  return ok
    ? { valid: true, address, addressType: "sapling" }
    : failure("INVALID_SIGNATURE", "Sapling signature did not verify");
}

/**
 * The high-level dispatcher: parse the SIWZ message, run all integrity
 * checks (domain, nonce, time window), and then verify the signature
 * using the appropriate algorithm for the address type.
 *
 * This is the function NextAuth and most consumers should call.
 */
export async function verifyMessage(
  message: string | SiwzMessage,
  signatureBase64: string,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  let msg: SiwzMessage;
  try {
    msg = typeof message === "string" ? SiwzMessage.parse(message) : message;
  } catch (err) {
    return failure("INVALID_MESSAGE", (err as Error).message);
  }

  if (opts.expectedDomain && msg.domain !== opts.expectedDomain) {
    return failure(
      "DOMAIN_MISMATCH",
      `expected domain "${opts.expectedDomain}" but message claims "${msg.domain}"`,
    );
  }
  if (opts.expectedNonce && msg.nonce !== opts.expectedNonce) {
    return failure(
      "NONCE_MISMATCH",
      `expected nonce "${opts.expectedNonce}" but message contains "${msg.nonce}"`,
    );
  }

  const timeErr = msg.checkTimeValidity(opts.now);
  if (timeErr) return failure(timeErr, `message is ${timeErr.toLowerCase().replace("_", " ")}`);

  const parsed = parseAddress(msg.address);
  const wire = typeof message === "string" ? message : msg.toString();

  switch (parsed.type) {
    case "p2pkh":
      return verifyTransparentSignature(wire, signatureBase64, msg.address);
    case "sapling":
      return verifySaplingSignature(wire, signatureBase64, msg.address, opts.saplingVerifier);
    case "unified":
      return failure(
        "UNSUPPORTED_ADDRESS_TYPE",
        "Unified addresses are not signed directly — extract a transparent or sapling receiver client-side and sign with that. The UA can still be the displayed identity.",
      );
    case "orchard":
      return failure(
        "UNSUPPORTED_ADDRESS_TYPE",
        "Standalone Orchard signing is not yet defined by a finalized ZIP. Use a Sapling or transparent receiver from a UA instead.",
      );
    case "p2sh":
      return failure(
        "UNSUPPORTED_ADDRESS_TYPE",
        "P2SH (t3.../t2...) addresses cannot sign messages — they're scripts, not keys.",
      );
  }
}

function failure(error: NonNullable<VerifyResult["error"]>, msg: string): VerifyResult {
  return { valid: false, error, errorMessage: msg };
}

// Re-export for ergonomics
export { SiwzError };
