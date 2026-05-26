import { SiwzMessage, verifyMessage, type VerifyOptions } from "@siwz/core";
import { verifyNonceToken } from "./nonce.js";

/**
 * Per-request credential payload submitted by the client. The component in
 * @siwz/react posts these fields verbatim to NextAuth's credentials endpoint.
 */
export interface SiwzCredentials {
  /** The serialized SIWZ message exactly as it was signed. */
  message: string;
  /** Base64-encoded signature (Bitcoin/Zcash signmessage 65-byte format). */
  signature: string;
  /** The signed nonce token that was issued for this attempt. */
  nonceToken: string;
}

/**
 * The user object NextAuth's authorize() will return on success. NextAuth
 * persists `id` as the canonical identifier across the session and JWT;
 * we use the Zcash address itself so apps can do
 * `session.user.id === t1...` lookups.
 */
export interface SiwzUser {
  id: string;
  name: string;
  /** Address type that signed (p2pkh, sapling, ...). */
  addressType: string;
  /** Zcash network the address belongs to. */
  network: string;
}

export interface SiwzProviderOptions {
  /**
   * The domain users will see in the SIWZ challenge ("example.com",
   * "myapp.com:3000"). MUST match what the client uses or verification
   * will fail. Typically derived from request headers; for tests, pin a
   * constant.
   */
  expectedDomain: string;
  /**
   * Shared secret used to sign nonce tokens. Reuse NEXTAUTH_SECRET in
   * production. Required.
   */
  secret: string;
  /**
   * Optional override of the credentials provider ID (default "siwz").
   * Change this if you also expose a separate "siwe" or other providers.
   */
  id?: string;
  /**
   * Optional ZIP 304 Sapling verifier. Required if you want to support
   * z-addr sign-in. See @siwz/core docs/sapling-wasm.md.
   */
  saplingVerifier?: VerifyOptions["saplingVerifier"];
}

/**
 * Returns a NextAuth v4 CredentialsProvider config that authenticates
 * users via a Sign-In-with-Zcash signed message.
 *
 * Usage (NextAuth v4):
 *
 *   import NextAuth from "next-auth";
 *   import { SiwzProvider } from "@siwz/next-auth";
 *
 *   export default NextAuth({
 *     providers: [SiwzProvider({
 *       expectedDomain: "example.com",
 *       secret: process.env.NEXTAUTH_SECRET!,
 *     })],
 *     session: { strategy: "jwt" },
 *     callbacks: {
 *       async jwt({ token, user }) {
 *         if (user) token.address = user.id;
 *         return token;
 *       },
 *       async session({ session, token }) {
 *         (session.user as any).address = token.address;
 *         return session;
 *       },
 *     },
 *   });
 *
 * The provider returns a *plain object* rather than calling
 * `CredentialsProvider(...)` itself so that consumers can use either
 * next-auth v4's import path or Auth.js v5's `Credentials` provider
 * without us depending on a specific version.
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

        // Step 1 — verify the nonce token. This rejects replays of old
        // signatures past their TTL, and signatures issued under a
        // different secret (e.g. a stale dev key in production).
        const nonceResult = verifyNonceToken(c.nonceToken, { secret: opts.secret });
        if (!nonceResult.ok) {
          console.warn(`[siwz] nonce rejected: ${nonceResult.error}`);
          return null;
        }

        // Step 2 — parse the message and assert the embedded nonce matches.
        // This is what binds the user's signature to *this* sign-in attempt.
        const msg = SiwzMessage.parse(c.message);
        if (msg.nonce !== nonceResult.nonce) {
          console.warn("[siwz] message nonce does not match issued nonce");
          return null;
        }

        // Step 3 — cryptographic verification.
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
