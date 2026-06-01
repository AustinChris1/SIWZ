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

## Memo-challenge handlers

For the memo-challenge sign-in path (the one [`<MemoSignIn />`](https://www.npmjs.com/package/@siwz/react) drives), `@siwz/next-auth/memo` exposes two App Router POST handlers that turn the server side into a one-liner each:

```ts
// app/api/auth/memo/issue/route.ts
import { issueMemoHandler } from "@siwz/next-auth/memo";

export const POST = issueMemoHandler({
  secret: process.env.NEXTAUTH_SECRET!,
  serviceAddress: process.env.SIWZ_SERVICE_ADDRESS!,
  network: "mainnet",
});
```

```ts
// app/api/auth/memo/poll/route.ts
import { pollMemoHandler } from "@siwz/next-auth/memo";
import { BlockchairExplorer } from "@siwz/core/explorers";

export const POST = pollMemoHandler({
  secret: process.env.NEXTAUTH_SECRET!,
  explorer: new BlockchairExplorer(),
});
```

That's the entire server. `<MemoSignIn />` posts to these routes by default, so the client side is just `<MemoSignIn onSuccess={…} />`.

### Wire convention

`<MemoSignIn />` treats any non-2xx as a transient network error and silently retries until its timeout. The handlers follow this convention so the component behaves correctly:

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ ok: true, identity, txid, mode }` | Match. Sign the user in. |
| 202 | `{ ok: false, retryable: true }` | No match yet. Keep polling. |
| 4xx | `{ ok: false, error: "..." }` | Terminal (bad token, malformed body). Stop. |

If you write a custom poll handler, mirror this. Returning 4xx for "not yet matched" causes the component to silently retry instead of failing fast on terminal errors.

### Shielded-memo sign-in

`BlockchairExplorer` only indexes the public chain. For shielded-memo (the `zs…`/`u1…` service-address case), implement the `MemoExplorer` interface against a backend that holds the IVK and pass that instead:

```ts
import type { MemoExplorer } from "@siwz/core";

const zingoExplorer: MemoExplorer = {
  async getRecentMemosToAddress(address, limit) {
    // call your lightwallet-rpc / zcashd / zaino wrapper
    return [{ txid: "...", memo: "SIWZ:abc123", amountZatoshi: 100n }];
  },
};
```

`pollMemoHandler` dispatches by the address type encoded in the issue token, so the same route serves both flows depending on what `serviceAddress` was set to.

### Identity continuity

To thread a UFVK or a previous anonymous id through the issue body (so the same wallet always resolves to the same identity), pass `resolveIdentity`:

```ts
issueMemoHandler({
  secret: process.env.NEXTAUTH_SECRET!,
  serviceAddress: process.env.SIWZ_SERVICE_ADDRESS!,
  network: "mainnet",
  resolveIdentity: async (body) => {
    const { ufvk } = body as { ufvk?: string };
    if (ufvk) return await canonicalIdentityFromUfvk(ufvk);
    return undefined;
  },
});
```

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

```ts
// Subpath: @siwz/next-auth/memo
issueMemoHandler(opts)                         // -> (req: Request) => Promise<Response>
pollMemoHandler(opts)                          // -> (req: Request) => Promise<Response>

// Types
type IssueMemoHandlerOptions, PollMemoHandlerOptions
```

## Related packages

- [`@siwz/core`](https://www.npmjs.com/package/@siwz/core): protocol primitives.
- [`@siwz/react`](https://www.npmjs.com/package/@siwz/react): drop-in components and Snap helpers.

## License

MIT
