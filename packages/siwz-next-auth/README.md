# @siwz/next-auth

[![npm](https://img.shields.io/npm/v/@siwz/next-auth.svg)](https://www.npmjs.com/package/@siwz/next-auth)

NextAuth.js v4 / Auth.js v5 credentials provider for **Sign in with Zcash**, plus stateless HMAC nonce helpers for serverless backends.

Docs and live demos: <https://siwz.vercel.app>

## Install

```bash
npm i @siwz/next-auth @siwz/core next-auth
```

Peer-deps: `next-auth >= 4`.

## Wire up NextAuth (v4 / App Router)

```ts
// app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { SiwzProvider } from "@siwz/next-auth";

const siwz = SiwzProvider({
  expectedDomain: "myapp.com",          // MUST match what the browser sees
  secret: process.env.NEXTAUTH_SECRET!, // also signs the nonce tokens
});

const handler = NextAuth({
  providers: [CredentialsProvider(siwz as any)],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.address = (user as any).id;
        token.network = (user as any).network;
      }
      return token;
    },
    async session({ session, token }) {
      (session.user as any).address = token.address;
      (session.user as any).network = token.network;
      return session;
    },
  },
});

export { handler as GET, handler as POST };
```

## Nonce endpoint

The provider needs a server-issued nonce per sign-in attempt. `issueNonce` and `verifyNonceToken` are stateless: they HMAC-sign `(nonce, expiry)` instead of storing anything.

```ts
// app/api/siwz/nonce/route.ts
import { NextResponse } from "next/server";
import { issueNonce } from "@siwz/next-auth/nonce";

export const dynamic = "force-dynamic";

export async function GET() {
  const issued = issueNonce({
    secret: process.env.NEXTAUTH_SECRET!,
    ttlSeconds: 600,
  });
  return NextResponse.json({
    nonce: issued.nonce,
    token: issued.token,
    expiresAt: issued.expiresAt.toISOString(),
  });
}
```

The `/nonce` subpath import is the small slice you can use without pulling in the rest of the provider. Useful if your nonce route runs in an edge runtime or you want to issue nonces from a separate service.

## Why stateless nonces

A naive nonce implementation stores `nonce -> expiry` in memory or a database. That works but adds a stateful component to an otherwise stateless flow.

`issueNonce` / `verifyNonceToken` use HMAC-SHA256 over `(nonce, expiry)` instead:

- Any backend instance with the same `NEXTAUTH_SECRET` verifies a token issued by any other.
- Replay-prevention guarantee is the same: a stolen but unexpired token only authenticates whoever already signed for that specific nonce.
- Constant-time comparison prevents timing oracles.

## Sapling (z-addr) sign-in

Pass `saplingVerifier` to `SiwzProvider` once you have a [ZIP 304](https://zips.z.cash/zip-0304) verifier wired up (typically a WASM wrapper around `librustzcash`). The provider then accepts z-addr signed messages automatically.

```ts
SiwzProvider({
  expectedDomain: "myapp.com",
  secret: process.env.NEXTAUTH_SECRET!,
  saplingVerifier: async ({ message, signature, address }) => {
    // hand off to your WASM verifier
    return verifyZip304(message, signature, address);
  },
});
```

## Auth.js v5

The same `SiwzProvider(...)` config object is consumed by Auth.js v5's `Credentials(...)` provider. Only the import line changes:

```ts
import Credentials from "next-auth/providers/credentials";
const handler = NextAuth({ providers: [Credentials(siwz as any)], /* ... */ });
```

## API surface

```ts
SiwzProvider(opts)
  // opts: SiwzProviderOptions = { expectedDomain, secret, id?, saplingVerifier? }

issueNonce({ secret, ttlSeconds? })            // -> { nonce, token, expiresAt }
verifyNonceToken(token, { secret })            // -> { ok: true, nonce } | { ok: false, error }

// Types
type SiwzProviderOptions, SiwzCredentials, SiwzUser
type NonceTokenOptions, IssuedNonce, VerifyNonceResult
```

## Related packages

- [`@siwz/core`](https://www.npmjs.com/package/@siwz/core): protocol primitives.
- [`@siwz/react`](https://www.npmjs.com/package/@siwz/react): drop-in components and Snap helpers.

## License

MIT
