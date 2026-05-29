import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyMemoChallenge } from "@siwz/core";

export const dynamic = "force-dynamic";

// Minimal poll endpoint. Transparent path scrapes Blockchair for recent
// outputs to the service address. Shielded path requires LIGHTWALLET_RPC_URL
// + LIGHTWALLET_RPC_TOKEN (point at apps/lightwallet-rpc on a VPS, or your
// own zcashd-backed indexer). In SIWZ_DEMO=1 we short-circuit to a mock match.
export async function POST(req: Request) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "NEXTAUTH_SECRET not set" }, { status: 500 });

  let body: { token?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad JSON" }, { status: 400 }); }
  const token = typeof body.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const parts = token.split(".");
  if (parts.length !== 2) return NextResponse.json({ error: "malformed token" }, { status: 400 });
  let recipient: string;
  let mode: "transparent-amount" | "shielded-memo";
  let amountZatoshi: bigint;
  try {
    const payloadJson = Buffer.from(parts[0]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(payloadJson) as { to?: string; z?: string; m?: string };
    recipient = payload.to!;
    amountZatoshi = BigInt(payload.z!);
    mode = payload.m === "sm" ? "shielded-memo" : "transparent-amount";
  } catch {
    return NextResponse.json({ error: "malformed token payload" }, { status: 400 });
  }

  // DEMO: pretend the payment landed, build a matching mock observation.
  if (process.env.SIWZ_DEMO === "1") {
    const matchAmount = mode === "transparent-amount" ? amountZatoshi : amountZatoshi;
    const result = await verifyMemoChallenge({
      secret,
      token,
      observedAmountZatoshi: matchAmount,
      observedRecipient: recipient,
      observedMemo: mode === "shielded-memo" ? `SIWZ:${extractNonce(token)}` : undefined,
    });
    if (result.ok && result.identity) return success(result.identity, secret, "demo-tx-" + Date.now().toString(16));
    return NextResponse.json({ ok: false, retryable: false, error: result.error }, { status: 400 });
  }

  if (mode === "transparent-amount") {
    const outputs = await fetchBlockchairOutputs(recipient).catch(() => []);
    for (const o of outputs) {
      const result = await verifyMemoChallenge({
        secret, token, observedAmountZatoshi: o.amountZatoshi, observedRecipient: recipient,
      });
      if (result.ok && result.identity) return success(result.identity, secret, o.txid);
    }
    return NextResponse.json({ ok: false, retryable: true }, { status: 202 });
  }

  // Shielded path: delegate to lightwallet-rpc.
  const lwUrl = process.env.LIGHTWALLET_RPC_URL;
  const lwToken = process.env.LIGHTWALLET_RPC_TOKEN;
  if (!lwUrl || !lwToken) {
    return NextResponse.json(
      { error: "Shielded sign-in needs LIGHTWALLET_RPC_URL + LIGHTWALLET_RPC_TOKEN. See apps/lightwallet-rpc." },
      { status: 500 },
    );
  }
  const memos = await fetchLightwalletMemos(lwUrl, lwToken, recipient).catch(() => []);
  for (const m of memos) {
    const result = await verifyMemoChallenge({
      secret, token, observedMemo: m.memo, observedRecipient: recipient,
    });
    if (result.ok && result.identity) return success(result.identity, secret, m.txid);
  }
  return NextResponse.json({ ok: false, retryable: true }, { status: 202 });
}

function extractNonce(token: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return payload.n ?? "";
  } catch { return ""; }
}

function success(identity: string, secret: string, txid: string) {
  // Envelope shape matches what apps/zecwall/src/lib/auth.ts verifies.
  const envelope = createHmac("sha256", secret).update(`memo::${identity}`).digest("hex");
  return NextResponse.json({ ok: true, identity, envelope, txid });
}

async function fetchBlockchairOutputs(address: string): Promise<{ txid: string; amountZatoshi: bigint }[]> {
  const url = new URL("https://api.blockchair.com/zcash/outputs");
  url.searchParams.set("q", `recipient(${address})`);
  url.searchParams.set("limit", "50");
  const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: { transaction_hash: string; value: string | number }[] };
  return (json.data ?? []).map((r) => ({ txid: r.transaction_hash, amountZatoshi: BigInt(r.value) }));
}

async function fetchLightwalletMemos(url: string, token: string, address: string): Promise<{ txid: string; memo: string }[]> {
  const res = await fetch(`${url.replace(/\/$/, "")}/memos`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ address, limit: 50 }),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { memos?: { txid: string; memo: string }[] };
  return json.memos ?? [];
}
