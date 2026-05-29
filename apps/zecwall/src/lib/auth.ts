import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { SiwzProvider } from "@siwz/next-auth";

const SECRET = process.env.NEXTAUTH_SECRET ?? "dev-secret-please-set-NEXTAUTH_SECRET";

const siwz = SiwzProvider({
  expectedDomain: process.env.SIWZ_DOMAIN ?? "localhost:3001",
  secret: SECRET,
});

const memo = CredentialsProvider({
  id: "memo",
  name: "Sign in with Zcash memo",
  credentials: {
    identity: { label: "Identity", type: "text" },
    envelope: { label: "Envelope", type: "text" },
  },
  async authorize(credentials) {
    const c = credentials as Partial<{ identity: string; envelope: string }> | undefined;
    if (!c?.identity || !c.envelope) return null;
    const expected = createHmac("sha256", SECRET).update(`memo::${c.identity}`).digest("hex");
    if (c.envelope.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(c.envelope), Buffer.from(expected))) return null;
    return { id: c.identity, name: c.identity };
  },
});

const snap = CredentialsProvider({
  id: "snap",
  name: "Sign in with MetaMask (Zcash Snap)",
  credentials: {
    fingerprint: { label: "Fingerprint", type: "text" },
    ufvk: { label: "UFVK", type: "text" },
    envelope: { label: "Envelope", type: "text" },
  },
  async authorize(credentials) {
    const c = credentials as Partial<{ fingerprint: string; ufvk: string; envelope: string }> | undefined;
    if (!c?.fingerprint || !c.ufvk || !c.envelope) return null;
    const expected = createHmac("sha256", SECRET).update(`${c.fingerprint}::${c.ufvk}`).digest("hex");
    if (c.envelope.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(c.envelope), Buffer.from(expected))) return null;
    // Identity derives from UFVK hash so a re-install of the Snap (which may
    // change the fingerprint) keeps the user as the same identity.
    const identity = `anon:${createHash("sha256").update(c.ufvk).digest("hex").slice(0, 32)}`;
    return { id: identity, name: identity };
  },
});

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider(siwz as Parameters<typeof CredentialsProvider>[0]),
    memo,
    snap,
  ],
  session: { strategy: "jwt" },
  secret: SECRET,
  pages: { signIn: "/" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.address = (user as { id: string }).id;
      return token;
    },
    async session({ session, token }) {
      (session.user as Record<string, unknown>).address = token.address;
      return session;
    },
  },
};
