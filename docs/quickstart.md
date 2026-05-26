# Quickstart

Add Sign in with Zcash to a new or existing Next.js app in five minutes.

## Install

```bash
npm i @siwz/core @siwz/react @siwz/next-auth next-auth
```

## 1. Set NEXTAUTH_SECRET

```bash
echo "NEXTAUTH_SECRET=$(openssl rand -base64 32)" >> .env.local
echo "NEXTAUTH_URL=http://localhost:3000" >> .env.local
```

## 2. Nonce endpoint

`app/api/siwz/nonce/route.ts`:

```ts
import { NextResponse } from "next/server";
import { issueNonce } from "@siwz/next-auth/nonce";

export const dynamic = "force-dynamic";

export async function GET() {
  const issued = issueNonce({ secret: process.env.NEXTAUTH_SECRET!, ttlSeconds: 600 });
  return NextResponse.json({ nonce: issued.nonce, token: issued.token });
}
```

## 3. NextAuth route

`app/api/auth/[...nextauth]/route.ts`:

```ts
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { SiwzProvider } from "@siwz/next-auth";

const siwz = SiwzProvider({
  expectedDomain: "localhost:3000",
  secret: process.env.NEXTAUTH_SECRET!,
});

const handler = NextAuth({
  providers: [CredentialsProvider(siwz as any)],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.address = (user as any).id;
      return token;
    },
    async session({ session, token }) {
      (session.user as any).address = token.address;
      return session;
    },
  },
});

export { handler as GET, handler as POST };
```

## 4. Sign-in component

`app/page.tsx` (client component or a small client island):

```tsx
"use client";

import { SignInWithZcash } from "@siwz/react";
import { signIn } from "next-auth/react";
import "@siwz/react/styles.css";

let savedToken = "";

export default function Page() {
  return (
    <SignInWithZcash
      domain="localhost:3000"
      uri="http://localhost:3000"
      network="mainnet"
      getNonce={async () => {
        const r = await fetch("/api/siwz/nonce", { cache: "no-store" });
        const { nonce, token } = await r.json();
        savedToken = token;
        return nonce;
      }}
      submit={async ({ message, signature }) => {
        const result = await signIn("siwz", {
          message,
          signature,
          nonceToken: savedToken,
          redirect: false,
        });
        return result?.ok ? { ok: true } : { ok: false, error: result?.error ?? "Sign-in failed" };
      }}
    />
  );
}
```

## 5. Read the session in your server code

```ts
import { getServerSession } from "next-auth";

const session = await getServerSession(authOptions);
const address = (session?.user as any)?.address; // → "t1Mzhr3..."
```

## Done

Your app now accepts Sign in with Zcash. Try it with any wallet that supports `signmessage`. See [wallets.md](./wallets.md) for per-wallet instructions you can show users.

For the security model, see [security.md](./security.md). For the wire format, see [spec.md](./spec.md). For Sapling z-addr support, see [sapling-wasm.md](./sapling-wasm.md).
