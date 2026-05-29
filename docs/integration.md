# Integrating SIWZ: pick your sign-in method

SIWZ has three sign-in methods, and they are not equal in how much the packages
do for you. Read this first:

| Method | What the packages give you | What you write yourself |
|---|---|---|
| **Signed message** | A drop-in: `SignInWithZcash` (UI) + `SiwzProvider` (verify) + `issueNonce` | Nothing beyond wiring it up |
| **Memo challenge** | Protocol helpers in `@siwz/core`: `issueMemoChallenge`, `verifyMemoChallenge` | The issue/poll routes, a "memo" credentials provider, a polling UI, and a memo-decrypting backend |
| **MetaMask snap** | `enableSnap` + `onSnapAuth` on `SignInWithZcash`, plus snap helpers in `@siwz/react` | A "snap" credentials provider and an envelope endpoint |

Only the signed-message path is truly "import and use." Memo and snap rely on a
small amount of app code that the reference apps already contain, so the honest
instruction for those two is "copy from the example app." A first-class
`<MemoSignIn>` component and packaged envelope helpers are on the roadmap.

All install the same way:

```bash
npm i @siwz/core @siwz/react @siwz/next-auth next-auth
```

`@siwz/core` is a dependency of the other two, so you always get it. Set
`NEXTAUTH_SECRET` (32+ random chars) and `NEXTAUTH_URL` in `.env.local`.

---

## I want only Signed message

The wallet signs a SIWZ message (the Zcash `signmessage` format) and the user
pastes the signature back. Transparent addresses work out of the box; shielded
(ZIP 304) needs a Sapling verifier (see [sapling-wasm.md](./sapling-wasm.md)).

**Import:** `SignInWithZcash` from `@siwz/react`, `SiwzProvider` and `issueNonce`
from `@siwz/next-auth`.

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
import CredentialsProvider from "next-auth/providers/credentials";
import { SiwzProvider } from "@siwz/next-auth";

const siwz = SiwzProvider({ expectedDomain: "localhost:3000", secret: process.env.NEXTAUTH_SECRET! });
const handler = NextAuth({ providers: [CredentialsProvider(siwz as never)], session: { strategy: "jwt" } });
export { handler as GET, handler as POST };
```

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

That is the whole integration. Full version: [quickstart.md](./quickstart.md). Reference app: `apps/example-comments` (the "Signed message" tab).

---

## I want only Memo challenge

The user sends a tiny shielded payment carrying a `SIWZ:<nonce>` memo (or, to a
transparent address, a unique amount). Your server watches the service address,
decrypts the memo, matches the nonce, and signs them in. This needs a
memo-decrypting backend (a `zingo-cli` wrapper or a zcashd RPC; see
[winning-deployment.md](./winning-deployment.md)), because only the viewing-key
holder can read shielded memos.

**Import:** `issueMemoChallenge` and `verifyMemoChallenge` from `@siwz/core`.
There is no memo UI component in `@siwz/react` yet, so you build the QR + poll UI
(copy it from the reference app).

**Issue route** (`app/api/auth/memo/issue/route.ts`):

```ts
import { issueMemoChallenge } from "@siwz/core";
export async function POST() {
  const c = await issueMemoChallenge({
    secret: process.env.NEXTAUTH_SECRET!,
    serviceAddress: process.env.SIWZ_SERVICE_ADDRESS!, // your zs.../u1.../t1...
    network: "mainnet",
    label: "My app",
    message: "Sign in by sending this payment.",
    ttlSeconds: 600,
  });
  return Response.json({ uri: c.uri, amountZec: c.amountZec, memo: c.memo, token: c.token });
}
```

**Poll route** (`app/api/auth/memo/poll/route.ts`): read recent memos for the
service address from your backend, then match each against the token:

```ts
import { verifyMemoChallenge } from "@siwz/core";
// const memos = await yourBackend.recentMemosTo(serviceAddress);
for (const m of memos) {
  const r = await verifyMemoChallenge({
    secret: process.env.NEXTAUTH_SECRET!,
    token,
    observedMemo: m.memo,
    observedRecipient: serviceAddress,
  });
  if (r.ok && r.identity) return Response.json({ ok: true, identity: r.identity }); // then mint a session
}
return new Response(null, { status: 202 }); // keep polling
```

**Session glue you provide:** a `CredentialsProvider({ id: "memo", ... })` whose
`authorize` accepts the matched identity plus an HMAC "envelope"
(`hmac(secret, "memo::" + identity)`) so a client cannot forge the result, and a
client that shows the QR from `issue` and polls `poll` until 200.

Reference implementation to copy: `apps/example-comments` (issue route, poll
route, the `MemoFlow` component, and the `memo` provider in `src/lib/auth.ts`).
A fuller version with auto-reconciliation lives in `apps/demo`.

---

## I want only MetaMask snap

The ChainSafe WebZjs Zcash Snap exposes a seed fingerprint and a unified viewing
key. You bind them to an identity with an HMAC envelope and mint a session. One
click, no QR, no on-chain fee.

**Import:** set `enableSnap` and pass `onSnapAuth` to `SignInWithZcash` from
`@siwz/react`. Lower-level helpers are also exported: `snapConnect`,
`snapGetSeedFingerprint`, `snapGetViewingKey`, `detectSnapEnvironment`,
`DEFAULT_SNAP_ID`.

**Client:**

```tsx
<SignInWithZcash
  domain="localhost:3000"
  uri="http://localhost:3000"
  network="mainnet"
  enableSnap
  getNonce={async () => /* as above */}
  submit={async () => /* the signed-message fallback */}
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

**Session glue you provide:** an envelope endpoint that HMACs `fingerprint::ufvk`
with your secret, and a `CredentialsProvider({ id: "snap", ... })` that verifies
that envelope and derives the identity from the UFVK hash. Reference: `apps/demo`
(`src/lib/snap-auth.ts` and the `snap-envelope` route).

**Important caveat:** the published ChainSafe snap restricts which dApp origins
can call it (`allowedOrigins`), so a third-party site cannot use it in production
today. It works on `localhost` with MetaMask Flask, or once ChainSafe broadens
the allowlist. Treat snap as a progressive enhancement and keep one of the other
methods as the real path. See [why-siwz.md](./why-siwz.md) and the architecture
notes for the full story.

---

## Offering more than one, or a custom UI

`apps/example-comments` shows all three behind tabs in about 150 lines. If you
want your own UI for the signed-message and snap flows, use the headless
`useSiwz()` hook from `@siwz/react` instead of `SignInWithZcash`; it returns the
state machine (`status`, `buildChallenge`, `submitSignature`, `trySnapSignIn`,
and so on) and you render whatever you like.

Read the session anywhere on the server with `getServerSession(authOptions)`; the
signed-in Zcash address (or memo/snap identity) is on `session.user.address`.
