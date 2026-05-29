"use client";

import { useEffect, useRef, useState } from "react";
import { SignInWithZcash, type SnapIdentity } from "@siwz/react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type Flow = "memo" | "siwz" | "snap";

// Three ways to sign in. ZecWall exists to show each one plainly.
const FLOWS: Record<Flow, { title: string; subtitle: string }> = {
  memo: { title: "Memo challenge", subtitle: "Sign in by sending a tiny shielded payment. Works with every Zcash wallet." },
  siwz: { title: "Signed message", subtitle: "Sign in by pasting a wallet signature (zcash-cli, YWallet)." },
  snap: { title: "MetaMask Snap", subtitle: "Sign in with the ChainSafe Zcash Snap. One click." },
};

export function SignInClient() {
  const router = useRouter();
  const { status } = useSession();
  const [flow, setFlow] = useState<Flow>("memo");
  if (status === "loading") return <div className="opacity-50">Loading…</div>;
  return (
    <div className="flex flex-col gap-3">
      <div className="tabs">
        {(Object.keys(FLOWS) as Flow[]).map((k) => (
          <button
            key={k}
            onClick={() => setFlow(k)}
            className={`tab${flow === k ? " active" : ""}`}
          >
            {FLOWS[k].title}
          </button>
        ))}
      </div>
      <div style={{ fontSize: "0.8rem", opacity: 0.6 }}>{FLOWS[flow].subtitle}</div>
      {flow === "memo" && <MemoFlow />}
      {flow === "siwz" && <ClassicFlow />}
      {flow === "snap" && <SnapFlow onUseDifferentWallet={() => setFlow("siwz")} />}
    </div>
  );
}

function ClassicFlow() {
  const router = useRouter();
  return (
    <SignInWithZcash
      domain={typeof window !== "undefined" ? window.location.host : "localhost:3001"}
      uri={typeof window !== "undefined" ? window.location.origin : "http://localhost:3001"}
      network="mainnet"
      statement="Sign in to the SIWZ reference comments wall."
      expirationSeconds={600}
      getNonce={async () => {
        const r = await fetch("/api/siwz/nonce", { cache: "no-store" });
        const j = (await r.json()) as { nonce: string; token: string };
        (window as unknown as { __siwzNonceToken?: string }).__siwzNonceToken = j.token;
        return j.nonce;
      }}
      submit={async ({ message, signature }) => {
        const nonceToken = (window as unknown as { __siwzNonceToken?: string }).__siwzNonceToken ?? "";
        const r = await signIn("siwz", { message, signature, nonceToken, redirect: false });
        if (!r?.ok) return { ok: false, error: r?.error ?? "rejected" };
        router.refresh();
        return { ok: true };
      }}
      onSuccess={() => router.refresh()}
    />
  );
}

function SnapFlow({ onUseDifferentWallet }: { onUseDifferentWallet: () => void }) {
  const router = useRouter();
  return (
    <SignInWithZcash
      domain={typeof window !== "undefined" ? window.location.host : "localhost:3001"}
      uri={typeof window !== "undefined" ? window.location.origin : "http://localhost:3001"}
      network="mainnet"
      enableSnap
      onUseDifferentWallet={onUseDifferentWallet}
      getNonce={async () => {
        const r = await fetch("/api/siwz/nonce", { cache: "no-store" });
        const j = (await r.json()) as { nonce: string; token: string };
        (window as unknown as { __siwzNonceToken?: string }).__siwzNonceToken = j.token;
        return j.nonce;
      }}
      submit={async ({ message, signature }) => {
        const nonceToken = (window as unknown as { __siwzNonceToken?: string }).__siwzNonceToken ?? "";
        const r = await signIn("siwz", { message, signature, nonceToken, redirect: false });
        if (!r?.ok) return { ok: false, error: r?.error ?? "rejected" };
        router.refresh();
        return { ok: true };
      }}
      onSnapAuth={async (info: SnapIdentity) => {
        const envRes = await fetch("/api/auth/snap-envelope", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fingerprint: info.fingerprint, ufvk: info.ufvk }),
        });
        if (!envRes.ok) {
          const j = await envRes.json().catch(() => ({}));
          return { ok: false, error: j.error ?? "envelope rejected" };
        }
        const { envelope } = await envRes.json();
        const r = await signIn("snap", { fingerprint: info.fingerprint, ufvk: info.ufvk, envelope, redirect: false });
        if (!r?.ok) return { ok: false, error: r?.error ?? "snap sign-in rejected" };
        router.refresh();
        return { ok: true };
      }}
      onSuccess={() => router.refresh()}
    />
  );
}

interface Challenge {
  uri: string;
  amountZec: string;
  serviceAddress: string;
  memo?: string;
  token: string;
  mode: "transparent-amount" | "shielded-memo";
  demoMode?: boolean;
}

function MemoFlow() {
  const router = useRouter();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const pollingRef = useRef(false);

  const begin = async () => {
    setError(null);
    setIssuing(true);
    try {
      const res = await fetch("/api/auth/memo/issue", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setChallenge(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIssuing(false);
    }
  };

  useEffect(() => {
    if (!challenge || signedIn) return;
    pollingRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (!pollingRef.current) return;
      try {
        const res = await fetch("/api/auth/memo/poll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: challenge.token }),
        });
        if (res.status === 200) {
          const { identity, envelope } = await res.json();
          pollingRef.current = false;
          setSignedIn(true);
          const r = await signIn("memo", { identity, envelope, redirect: false });
          if (!r?.ok) { setError(r?.error ?? "memo sign-in rejected"); setSignedIn(false); return; }
          router.refresh();
          return;
        }
        if (res.status >= 400 && res.status !== 404 && res.status !== 202) {
          setError((await res.json()).error ?? `HTTP ${res.status}`);
          pollingRef.current = false;
          return;
        }
      } catch (e) { console.warn(e); }
      if (pollingRef.current) timer = setTimeout(tick, 6_000);
    };
    timer = setTimeout(tick, 1_500);
    return () => { pollingRef.current = false; if (timer) clearTimeout(timer); };
  }, [challenge, signedIn, router]);

  if (!challenge) {
    return (
      <div className="card">
        <p className="opacity-80 text-sm">
          Sign in by sending a tiny shielded payment from any Zcash wallet. The
          unique amount or memo proves you control the wallet. No password, no custody.
        </p>
        <button className="btn" onClick={begin} disabled={issuing}>
          {issuing ? "Preparing…" : "Sign in with Zcash"}
        </button>
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-3">
      <img
        src={`/api/auth/memo/qr?uri=${encodeURIComponent(challenge.uri)}`}
        width={200}
        height={200}
        alt="Zcash payment QR"
        className="self-center bg-white rounded"
      />
      <div className="text-sm">
        <div><strong>Send:</strong> <code>{challenge.amountZec}</code> ZEC</div>
        <div className="break-all"><strong>To:</strong> <code>{challenge.serviceAddress}</code></div>
        {challenge.memo && <div className="break-all"><strong>Memo:</strong> <code>{challenge.memo}</code></div>}
      </div>
      <a href={challenge.uri} className="underline text-sm">Open in wallet →</a>
      {challenge.demoMode && (
        <div className="text-xs opacity-70">
          DEMO mode: the poll endpoint auto-matches without an actual on-chain tx.
        </div>
      )}
      {signedIn ? <p className="text-emerald-600 text-sm">Signing in…</p> : <p className="opacity-60 text-sm">Polling… (usually 5 to 15s after wallet send)</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}

export function SignOutButton() {
  return (
    <button className="btn" onClick={() => signOut({ callbackUrl: "/" })}>
      Sign out
    </button>
  );
}
