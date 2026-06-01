# Integrating SIWZ: pick your sign-in method

SIWZ ships three sign-in methods. With `@siwz/core@0.2.2+`, `@siwz/react@0.2.0+`, and `@siwz/next-auth@0.2.3+`, all three are drop-in:

| Method | Drop-in components | Drop-in server | What you still write |
|---|---|---|---|
| **Memo-challenge** (recommended) | `<MemoSignIn />` from `@siwz/react` | `issueMemoHandler` + `pollMemoHandler` from `@siwz/next-auth/memo`, plus `SiwzMemoProvider` for NextAuth | Zero for transparent. A `shieldedExplorer` adapter if you serve `zs…`/`u1…` sign-ins. |
| **Signed message** | `<SignInWithZcash />` from `@siwz/react` | `SiwzProvider` + `issueNonce` from `@siwz/next-auth` | Zero |
| **MetaMask snap** | `enableSnap` + `onSnapAuth` on `<SignInWithZcash />` | snap helpers in `@siwz/react` | A "snap" credentials provider and an envelope endpoint (see the ZBooks reference) |
| **Sign out** | `<SignOut />` from `@siwz/react` (idle / busy / optional-confirm states) | n/a; uses your auth layer's signOut() | Zero |

All install the same way:

```bash
npm i @siwz/core @siwz/react @siwz/next-auth next-auth
```

`@siwz/core` is a peer of the other two, so you always get it. Set `NEXTAUTH_SECRET` (≥ 32 random chars) and `NEXTAUTH_URL` in `.env.local`.

---

## I want only Memo-challenge

The user sends a tiny payment to your service address; the amount (transparent) or the encrypted memo (shielded) binds the payment to a sign-in attempt. Every Zcash wallet that speaks ZIP 321 works.

**Import:** `<MemoSignIn />` from `@siwz/react`, `issueMemoHandler` + `pollMemoHandler` from `@siwz/next-auth/memo`, `SiwzMemoProvider` from `@siwz/next-auth`.

**Server, issue route** (`app/api/auth/memo/issue/route.ts`):

```ts
import { issueMemoHandler } from "@siwz/next-auth/memo";

export const POST = issueMemoHandler({
  secret: process.env.NEXTAUTH_SECRET!,
  serviceAddress: process.env.SIWZ_SERVICE_ADDRESS!,
  network: "mainnet",
});
```

**Server, poll route** (`app/api/auth/memo/poll/route.ts`):

```ts
import { pollMemoHandler } from "@siwz/next-auth/memo";

export const POST = pollMemoHandler({
  secret: process.env.NEXTAUTH_SECRET!,
});
```

No explorer wiring. `pollMemoHandler` defaults to a `MultiExplorer` chaining `ThreeXplExplorer` (3xpl sandbox, anonymous) and `BlockchairExplorer` (public tier). Set `THREEXPL_API_KEY` or `BLOCKCHAIR_API_KEY` env vars to use paid tiers if you need more throughput.

**Server, NextAuth route** (`app/api/auth/[...nextauth]/route.ts`):

```ts
import NextAuth from "next-auth";
import { SiwzMemoProvider } from "@siwz/next-auth";

const handler = NextAuth({
  providers: [SiwzMemoProvider({ secret: process.env.NEXTAUTH_SECRET! })],
  session: { strategy: "jwt" },
});

export { handler as GET, handler as POST };
```

**Client:**

```tsx
"use client";
import { MemoSignIn } from "@siwz/react";
import { signIn } from "next-auth/react";
import "@siwz/react/styles.css";

export function SignIn() {
  return (
    <MemoSignIn
      onSuccess={async ({ identity, envelope }) => {
        await signIn("memo", { identity, envelope, redirect: false });
      }}
    />
  );
}
```

That's the whole integration. Reference apps: `apps/zecwall` (minimal) and `apps/demo` (full ZBooks with UFVK auto-import and demo-mode toggle).

### Shielded-memo sign-in

`zs…` / `u1…` service addresses can't be observed by public block explorers. Pass a `shieldedExplorer` to `pollMemoHandler` that talks to an IVK-holding backend (apps/lightwallet-rpc, zcashd RPC, zaino):

```ts
import { pollMemoHandler } from "@siwz/next-auth/memo";
import type { MemoExplorer, RecentMemo } from "@siwz/next-auth/memo";

const shieldedExplorer: MemoExplorer = {
  async getRecentMemosToAddress(address, limit) {
    const res = await fetch(`${process.env.LIGHTWALLET_RPC_URL}/memos`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.LIGHTWALLET_RPC_TOKEN}`,
      },
      body: JSON.stringify({ address, limit: limit ?? 50 }),
    });
    if (!res.ok) throw new Error(`lightwallet-rpc returned ${res.status}`);
    const { memos } = (await res.json()) as { memos: RecentMemo[] };
    return memos;
  },
};

export const POST = pollMemoHandler({
  secret: process.env.NEXTAUTH_SECRET!,
  shieldedExplorer,
});
```

`pollMemoHandler` dispatches by the address type encoded in the issue token. Transparent service addresses use the free public default; shielded ones use your `shieldedExplorer`.

For deploying a `zingo-cli`-backed shielded backend, see [`winning-deployment.md`](./winning-deployment.md) and [`apps/lightwallet-rpc`](../apps/lightwallet-rpc) (Docker image available).

---

## I want only Signed message

The wallet signs a SIWZ message (Zcash `signmessage` format) and the user pastes the signature back. Transparent addresses work out of the box; shielded (ZIP 304) needs a Sapling verifier (see [sapling-wasm.md](./sapling-wasm.md)).

**Import:** `<SignInWithZcash />` from `@siwz/react`, `SiwzProvider` and `issueNonce` from `@siwz/next-auth`.

**Server, nonce route** (`app/api/siwz/nonce/route.ts`):

```ts
import { issueNonce } from "@siwz/next-auth/nonce";
export const dynamic = "force-dynamic";
export async function GET() {
  const { nonce, token } = issueNonce({ secret: process.env.NEXTAUTH_SECRET!, ttlSeconds: 600 });
  return Response.json({ nonce, token });
}
```

**Server, NextAuth route** (`app/api/auth/[...nextauth]/route.ts`):

```ts
import NextAuth from "next-auth";
import { SiwzProvider } from "@siwz/next-auth";

const handler = NextAuth({
  providers: [
    SiwzProvider({ expectedDomain: "localhost:3000", secret: process.env.NEXTAUTH_SECRET! }),
  ],
  session: { strategy: "jwt" },
});
export { handler as GET, handler as POST };
```

`SiwzProvider` returns a typed `CredentialsConfig`, so it goes straight into the array. No `as any`.

**Client:**

```tsx
"use client";
import { SignInWithZcash } from "@siwz/react";
import { signIn } from "next-auth/react";
import "@siwz/react/styles.css";

let token = "";
export function SignIn() {
  return (
    <SignInWithZcash
      domain="localhost:3000"
      uri="http://localhost:3000"
      network="mainnet"
      getNonce={async () => {
        const r = await (await fetch("/api/siwz/nonce", { cache: "no-store" })).json();
        token = r.token;
        return r.nonce;
      }}
      submit={async ({ message, signature }) => {
        const r = await signIn("siwz", { message, signature, nonceToken: token, redirect: false });
        return r?.ok ? { ok: true } : { ok: false, error: r?.error ?? "rejected" };
      }}
    />
  );
}
```

Full version: [quickstart.md](./quickstart.md). Reference app: `apps/zecwall` (the "Signed message" tab).

---

## I want only MetaMask snap

The ChainSafe WebZjs Zcash Snap exposes a seed fingerprint and a unified viewing key. You bind them to an identity with an HMAC envelope and mint a session. One click, no QR, no on-chain fee.

**Import:** set `enableSnap` and pass `onSnapAuth` to `<SignInWithZcash />` from `@siwz/react`. Lower-level helpers also exported: `snapConnect`, `snapGetSeedFingerprint`, `snapGetViewingKey`, `detectSnapEnvironment`, `DEFAULT_SNAP_ID`.

**Client:**

```tsx
<SignInWithZcash
  domain="localhost:3000"
  uri="http://localhost:3000"
  network="mainnet"
  enableSnap
  getNonce={/* as above */}
  submit={/* the signed-message fallback */}
  onSnapAuth={async ({ fingerprint, ufvk }) => {
    const { envelope } = await (await fetch("/api/auth/snap-envelope", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fingerprint, ufvk }),
    })).json();
    const r = await signIn("snap", { fingerprint, ufvk, envelope, redirect: false });
    return r?.ok ? { ok: true } : { ok: false, error: r?.error ?? "rejected" };
  }}
/>
```

**Session glue you provide:** an envelope endpoint that HMACs `fingerprint::ufvk` with your secret, and a `CredentialsProvider({ id: "snap", ... })` that verifies the envelope and derives identity from the UFVK hash. Reference: `apps/demo/src/lib/snap-auth.ts` and the `/api/auth/snap-envelope` route.

**Important caveat:** the published ChainSafe snap restricts which dApp origins can call it (`allowedOrigins`), so a third-party site cannot use it in production today. Works on `localhost` with MetaMask Flask, or once ChainSafe broadens the allowlist. Treat snap as a progressive enhancement; keep memo-challenge as the real path. Full story in [why-siwz.md](./why-siwz.md).

---

## Offering more than one, or a custom UI

`apps/zecwall` shows all three behind tabs in a few small files. If you want your own UI for the signed-message and snap flows, use the headless `useSiwz()` hook from `@siwz/react` instead of `<SignInWithZcash />`; it returns the state machine (`status`, `buildChallenge`, `submitSignature`, `trySnapSignIn`, etc.) and you render whatever you like.

Read the session anywhere on the server with `getServerSession(authOptions)`; the signed-in Zcash address (or memo / snap identity) is on `session.user.address` once you've augmented next-auth's `User` interface (see [quickstart.md §5](./quickstart.md#5-typing-the-session)).

For the matching sign-out flow, drop in `<SignOut onSignOut={() => signOut({ callbackUrl: "/" })} />` from `@siwz/react`. Three variants (`primary` / `secondary` / `link`), optional inline confirm prompt, busy state during the sign-out call.
