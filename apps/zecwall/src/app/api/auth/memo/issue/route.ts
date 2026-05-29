import { NextResponse } from "next/server";
import { issueMemoChallenge, parseAddress } from "@siwz/core";

export const dynamic = "force-dynamic";

const SERVICE_ADDRESS = process.env.SIWZ_SERVICE_ADDRESS;

export async function POST() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "NEXTAUTH_SECRET not set" }, { status: 500 });
  if (!SERVICE_ADDRESS) {
    return NextResponse.json(
      { error: "SIWZ_SERVICE_ADDRESS not set. Paste a t1… or zs… address into .env.local." },
      { status: 500 },
    );
  }

  const challenge = await issueMemoChallenge({
    secret,
    serviceAddress: SERVICE_ADDRESS,
    network: (process.env.SIWZ_NETWORK as "mainnet" | "testnet" | "regtest") ?? "mainnet",
    label: "SIWZ comments wall",
    message: "Sign in to leave a comment. Tiny dust payment proves you control a Zcash wallet.",
    ttlSeconds: 600,
  });

  return NextResponse.json({
    mode: challenge.mode,
    uri: challenge.uri,
    amountZec: challenge.amountZec,
    amountZatoshi: challenge.amountZatoshi,
    memo: challenge.memo,
    serviceAddress: challenge.serviceAddress,
    serviceAddressType: parseAddress(challenge.serviceAddress).type,
    token: challenge.token,
    expiresAt: challenge.expiresAt,
    demoMode: process.env.SIWZ_DEMO === "1",
  });
}
