import { SiwzMessage, verifyMessage, type VerifyOptions } from "@siwz/core";
import { verifyNonceToken } from "./nonce.js";

/** Credential payload posted by @siwz/react to NextAuth's credentials endpoint. */
export interface SiwzCredentials {
  /** The serialized SIWZ message exactly as it was signed. */
  message: string;
  /** Base64-encoded signature (Bitcoin/Zcash signmessage 65-byte format). */
  signature: string;
  /** The signed nonce token issued for this attempt. */
  nonceToken: string;
}

/** User object returned from NextAuth's authorize() on success. `id` is the Zcash address. */
export interface SiwzUser {
  id: string;
  name: string;
  /** Address type that signed (p2pkh, sapling, ...). */
  addressType: string;
  /** Zcash network the address belongs to. */
  network: string;
}

export interface SiwzProviderOptions {
  /** Domain embedded in the SIWZ challenge. Must match what the client uses. */
  expectedDomain: string;
  /** Shared secret for signing nonce tokens. Reuse NEXTAUTH_SECRET. */
  secret: string;
  /** Override the credentials provider ID. Default "siwz". */
  id?: string;
  /** ZIP 304 Sapling verifier. Required for z-addr sign-in. */
  saplingVerifier?: VerifyOptions["saplingVerifier"];
}

/**
 * Returns a NextAuth credentials provider config that authenticates users via
 * a Sign-In-with-Zcash signed message. Returns a plain object so it works with
 * both NextAuth v4 and Auth.js v5.
 */
export function SiwzProvider(opts: SiwzProviderOptions) {
  if (!opts.expectedDomain) throw new Error("SiwzProvider: expectedDomain is required");
  if (!opts.secret || opts.secret.length < 16) {
    throw new Error("SiwzProvider: secret must be ≥ 16 characters");
  }

  return {
    id: opts.id ?? "siwz",
    name: "Sign in with Zcash",
    type: "credentials" as const,
    credentials: {
      message:     { label: "Message",     type: "text" },
      signature:   { label: "Signature",   type: "text" },
      nonceToken:  { label: "Nonce Token", type: "text" },
    },
    authorize: async (
      credentials: Partial<Record<keyof SiwzCredentials, unknown>> | undefined,
    ): Promise<SiwzUser | null> => {
      try {
        const c = credentials as Partial<SiwzCredentials> | undefined;
        if (!c?.message || !c.signature || !c.nonceToken) return null;

        const nonceResult = verifyNonceToken(c.nonceToken, { secret: opts.secret });
        if (!nonceResult.ok) {
          console.warn(`[siwz] nonce rejected: ${nonceResult.error}`);
          return null;
        }

        const msg = SiwzMessage.parse(c.message);
        if (msg.nonce !== nonceResult.nonce) {
          console.warn("[siwz] message nonce does not match issued nonce");
          return null;
        }

        const result = await verifyMessage(msg, c.signature, {
          expectedDomain: opts.expectedDomain,
          expectedNonce: nonceResult.nonce,
          saplingVerifier: opts.saplingVerifier,
        });
        if (!result.valid) {
          console.warn(`[siwz] verifyMessage failed: ${result.error} – ${result.errorMessage}`);
          return null;
        }

        return {
          id: msg.address,
          name: msg.address,
          addressType: result.addressType ?? "unknown",
          network: msg.network,
        };
      } catch (err) {
        console.error("[siwz] authorize threw:", err);
        return null;
      }
    },
  };
}

export { issueNonce, verifyNonceToken } from "./nonce.js";
export type { NonceTokenOptions, IssuedNonce, VerifyNonceResult } from "./nonce.js";
