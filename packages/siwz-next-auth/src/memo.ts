// Next.js App Router route handlers for the memo-challenge sign-in flow.
// Pair with <MemoSignIn /> from @siwz/react.

import { createHmac } from "node:crypto";
import {
  issueMemoChallenge,
  verifyMemoChallenge,
  type MemoExplorer,
  type Network,
} from "@siwz/core";

/** Default envelope: HMAC-SHA256(secret, "memo::" + identity), hex. */
export function defaultMemoEnvelope(identity: string, secret: string): string {
  return createHmac("sha256", secret).update(`memo::${identity}`).digest("hex");
}

export interface IssueMemoHandlerOptions {
  /** HMAC secret. Use process.env.NEXTAUTH_SECRET or equivalent. */
  secret: string;
  /** Treasury / service address. t1 for transparent-amount, zs/u1 for shielded-memo. */
  serviceAddress: string;
  network: Network;
  /** ZIP 321 label shown by the wallet. Default: "Sign in". */
  label?: string;
  /** ZIP 321 message field. */
  message?: string;
  /** Challenge TTL. Default: 600 (10 minutes). */
  ttlSeconds?: number;
  /** Thread a UFVK or previous anonId through the issue body. */
  resolveIdentity?: (
    body: unknown,
    req: Request,
  ) => Promise<string | undefined> | string | undefined;
}

/** App Router POST handler that issues memo challenges. */
export function issueMemoHandler(
  opts: IssueMemoHandlerOptions,
): (req: Request) => Promise<Response> {
  const ttlSeconds = opts.ttlSeconds ?? 600;
  return async (req: Request): Promise<Response> => {
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is fine; identity stays undefined.
    }
    let identity: string | undefined;
    if (opts.resolveIdentity) {
      try {
        identity = await opts.resolveIdentity(body, req);
      } catch (err) {
        return jsonError(`resolveIdentity threw: ${(err as Error).message}`, 500);
      }
    }
    try {
      const challenge = await issueMemoChallenge({
        secret: opts.secret,
        serviceAddress: opts.serviceAddress,
        network: opts.network,
        identity,
        label: opts.label ?? "Sign in",
        message: opts.message,
        ttlSeconds,
      });
      return Response.json({
        mode: challenge.mode,
        uri: challenge.uri,
        amountZec: challenge.amountZec,
        amountZatoshi: challenge.amountZatoshi,
        memo: challenge.memo,
        serviceAddress: challenge.serviceAddress,
        token: challenge.token,
        expiresAt: challenge.expiresAt,
      });
    } catch (err) {
      return jsonError(`issueMemoChallenge failed: ${(err as Error).message}`, 500);
    }
  };
}

export interface PollMemoHandlerOptions {
  secret: string;
  explorer: MemoExplorer;
  /** Recent outputs / memos scanned per poll. Default: 50. */
  scanLimit?: number;
  /** Override the envelope shape. Return `null` to omit. Default: defaultMemoEnvelope. */
  buildEnvelope?: (identity: string, secret: string) => string | null;
}

/** App Router POST handler for memo-challenge polling.
 *  Returns 200 on match, 202 while waiting, 4xx for terminal errors. */
export function pollMemoHandler(
  opts: PollMemoHandlerOptions,
): (req: Request) => Promise<Response> {
  const scanLimit = opts.scanLimit ?? 50;
  return async (req: Request): Promise<Response> => {
    let body: { token?: unknown };
    try {
      body = (await req.json()) as { token?: unknown };
    } catch {
      return jsonError("Invalid JSON body", 400);
    }
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) return jsonError("token is required", 400);

    let recipient: string;
    let mode: "transparent-amount" | "shielded-memo";
    try {
      const [payloadPart, signaturePart] = token.split(".");
      if (!payloadPart || !signaturePart) throw new Error("malformed");
      const payload = JSON.parse(decodeBase64Url(payloadPart)) as { to?: string; m?: string };
      if (typeof payload.to !== "string") throw new Error("no recipient");
      recipient = payload.to;
      mode = payload.m === "sm" ? "shielded-memo" : "transparent-amount";
    } catch {
      return jsonError("malformed token", 400);
    }

    if (mode === "transparent-amount") {
      if (!opts.explorer.getRecentOutputsToAddress) {
        return jsonError(
          "Explorer does not implement getRecentOutputsToAddress; cannot serve transparent-amount sign-in",
          500,
        );
      }
      let outputs;
      try {
        outputs = await opts.explorer.getRecentOutputsToAddress(recipient, scanLimit);
      } catch (err) {
        return jsonError(`Explorer lookup failed: ${(err as Error).message}`, 502);
      }
      for (const output of outputs) {
        const result = await verifyMemoChallenge({
          secret: opts.secret,
          token,
          observedAmountZatoshi: output.amountZatoshi,
          observedRecipient: output.address,
        });
        if (result.ok && result.identity) {
          const envelope = (opts.buildEnvelope ?? defaultMemoEnvelope)(
            result.identity,
            opts.secret,
          );
          return Response.json({
            ok: true,
            mode,
            identity: result.identity,
            ...(envelope !== null ? { envelope } : {}),
            txid: output.txid,
          });
        }
      }
      return Response.json({ ok: false, retryable: true }, { status: 202 });
    }

    if (!opts.explorer.getRecentMemosToAddress) {
      return jsonError(
        "Explorer does not implement getRecentMemosToAddress; cannot serve shielded-memo sign-in",
        500,
      );
    }
    let memos;
    try {
      memos = await opts.explorer.getRecentMemosToAddress(recipient, scanLimit);
    } catch (err) {
      return jsonError(`Explorer lookup failed: ${(err as Error).message}`, 502);
    }
    for (const m of memos) {
      const result = await verifyMemoChallenge({
        secret: opts.secret,
        token,
        observedMemo: m.memo,
        observedRecipient: recipient,
      });
      if (result.ok && result.identity) {
        const envelope = (opts.buildEnvelope ?? defaultMemoEnvelope)(
          result.identity,
          opts.secret,
        );
        return Response.json({
          ok: true,
          mode,
          identity: result.identity,
          ...(envelope !== null ? { envelope } : {}),
          txid: m.txid,
        });
      }
    }
    return Response.json({ ok: false, retryable: true }, { status: 202 });
  };
}

function jsonError(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status });
}

function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  if (typeof atob === "function") return atob(padded);
  return Buffer.from(padded, "base64").toString("utf8");
}
