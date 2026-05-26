# `@siwz/next-auth`

NextAuth.js v4 / Auth.js v5 credentials provider for Sign in with Zcash. Plus stateless signed-nonce helpers.

## Install

```bash
npm i @siwz/next-auth @siwz/core next-auth
```

## Wire up NextAuth (v4 / app router)

```ts
// app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { SiwzProvider } from "@siwz/next-auth";

const siwz = SiwzProvider({
  expectedDomain: "myapp.com",          // MUST match what the browser sees
  secret: process.env.NEXTAUTH_SECRET!, // reused to sign nonce tokens
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

## Why stateless nonces?

A naive nonce implementation stores `nonce → expiry` in memory or a database. That works, but is fiddly across multiple Node instances and adds a stateful component to an otherwise stateless flow.

`issueNonce` / `verifyNonceToken` use HMAC-SHA256 over `(nonce, expiry)` instead:

- Any backend instance with the same `NEXTAUTH_SECRET` can verify a token issued by any other.
- Replay-prevention guarantee is the same: a stolen but unexpired token only authenticates whoever already signed for that specific nonce.
- Constant-time comparison thwarts timing oracles.

## Sapling (z-addr) sign-in

Pass `saplingVerifier` to `SiwzProvider` once you have a [ZIP 304](https://zips.z.cash/zip-0304) verifier wired up. See [docs/sapling-wasm.md](../../docs/sapling-wasm.md).

## Auth.js v5

The same `SiwzProvider(...)` config object is consumed by Auth.js v5's `Credentials(...)` provider. The only thing that changes is the import:

```ts
import Credentials from "next-auth/providers/credentials";
// ... rest is identical
```
