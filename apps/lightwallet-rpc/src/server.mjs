#!/usr/bin/env node
// HTTP wrapper around zingo-cli. Exposes POST /memos and POST /transactions
// behind bearer auth for SIWZ-using apps.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ZCASH_BLOCKS } from "./zcash-blocks.mjs";

const PORT = parseInt(process.env.PORT ?? "18232", 10);
const TOKEN = process.env.LIGHTWALLET_RPC_TOKEN;
const ZINGO = process.env.ZINGO_CLI_PATH ?? "zingo-cli";
const WALLET_DIR = process.env.ZINGO_WALLET_DIR;
const UFVK_WALLETS_DIR = process.env.ZINGO_UFVK_WALLETS_DIR ?? join(homedir(), ".zingo-ufvks");
const exec = promisify(execFile);

if (!existsSync(UFVK_WALLETS_DIR)) {
  mkdirSync(UFVK_WALLETS_DIR, { recursive: true });
}

if (!TOKEN) {
  console.error("FATAL: LIGHTWALLET_RPC_TOKEN env var is required.");
  console.error("Generate one with:");
  console.error(`  node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`);
  process.exit(1);
}
if (TOKEN.length < 32) {
  console.error("FATAL: LIGHTWALLET_RPC_TOKEN must be at least 32 chars.");
  process.exit(1);
}

const TOKEN_BUF = Buffer.from(TOKEN);

// zingo-cli v0.2+ takes the command as a positional arg (the old `--command`
// flag was removed). `--waitsync` blocks until the startup sync catches up.
async function zingoCmd(cmd) {
  const baseArgs = WALLET_DIR ? ["--data-dir", WALLET_DIR] : [];
  const args = [...baseArgs, "--waitsync", cmd];
  const { stdout } = await exec(ZINGO, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });
  // zingo-cli interleaves JSON with status lines like "Launching sync task..."
  // and "Zingo CLI quit successfully.", so walk the string to extract the block.
  const block = extractJsonBlock(stdout);
  if (!block) throw new Error(`zingo returned no JSON in output: ${stdout.slice(0, 400)}`);
  return JSON.parse(block);
}

function extractJsonBlock(s) {
  const firstOpen = s.search(/[\{\[]/);
  if (firstOpen === -1) return null;
  const stack = [];
  let inString = false;
  let escape = false;
  for (let i = firstOpen; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === "\"") { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (stack.length === 0) return s.slice(firstOpen, i + 1);
    }
  }
  return null;
}

// zingo-cli v0.2's `messages` returns { value_transfers: [...] }; older
// versions return a flat array. Per-transfer field names also drift between
// versions, hence the defensive key lookups below.
async function listIncomingMemos(address, limit) {
  const data = await zingoCmd("messages");
  const transfers = Array.isArray(data) ? data : (data?.value_transfers ?? []);
  if (!Array.isArray(transfers)) {
    throw new Error(`'messages' returned unexpected shape: ${JSON.stringify(data).slice(0, 200)}`);
  }

  const out = [];
  for (const t of transfers) {
    if (!t || typeof t !== "object") continue;
    const memo = pickMemo(t, address);
    if (!memo) continue;
    // Different zingo versions report direction as `kind`, `direction`,
    // or only via the amount sign, so check all three.
    const kind = t.kind ?? t.direction ?? null;
    if (kind && /out/i.test(String(kind))) continue;
    const amountRaw = t.amount ?? t.value ?? t.zatoshis ?? 0;
    if (typeof amountRaw === "number" && amountRaw < 0) continue;
    out.push({
      txid: t.txid ?? t.tx_id ?? t.transaction_id ?? t.id ?? "<unknown>",
      memo,
      amountZatoshi: zatoshiString(amountRaw),
      blockHeight: t.block_height ?? t.height ?? t.blockheight ?? undefined,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// zingo reports amounts as integer zatoshi *or* decimal ZEC depending on
// the command; decimals get scaled by 1e8. String return keeps it JSON-safe.
function zatoshiString(raw) {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1e8));
}

// Source: packages/siwz-core/src/zcash-blocks.ts. Override with `birthday` in POST body.
const DEFAULT_WALLET_BIRTHDAY = ZCASH_BLOCKS.SAFE_RECENT_BIRTHDAY;

// Dedupes concurrent /transactions calls per UFVK. Two zingo-cli processes
// against the same wallet dir corrupt it, and nginx 504 retries are common.
const ufvkSyncInFlight = new Map();

async function zingoCmdForUfvk(ufvk, walletDir, cmd, opts = {}) {
  const isFresh = !existsSync(join(walletDir, "zingo-wallet.dat"));
  const baseArgs = ["--data-dir", walletDir];
  if (isFresh) {
    // zingo-cli v0.2 `--viewkey` requires `--birthday`, or it errors out.
    const birthday = Number.isFinite(opts.birthday) ? Math.max(0, Math.floor(opts.birthday)) : DEFAULT_WALLET_BIRTHDAY;
    baseArgs.push("--viewkey", ufvk, "--birthday", String(birthday));
  }
  const args = [...baseArgs, "--waitsync", cmd];
  const { stdout, stderr } = await exec(ZINGO, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 5 * 60_000,
  });
  const block = extractJsonBlock(stdout);
  if (!block) {
    const stdoutHint = stdout.trim().slice(0, 400) || "(empty)";
    const stderrHint = (stderr || "").trim().slice(0, 400) || "(empty)";
    throw new Error(`zingo "${cmd}" returned no JSON. stdout=${stdoutHint} stderr=${stderrHint}`);
  }
  return JSON.parse(block);
}

function walletDirForUfvk(ufvk) {
  const h = createHash("sha256").update(ufvk).digest("hex").slice(0, 16);
  return join(UFVK_WALLETS_DIR, h);
}

async function syncUfvkTransactions(ufvk, opts = {}) {
  const inflight = ufvkSyncInFlight.get(ufvk);
  if (inflight) return inflight;
  const promise = (async () => {
    try {
      return await _syncUfvkTransactionsImpl(ufvk, opts);
    } finally {
      ufvkSyncInFlight.delete(ufvk);
    }
  })();
  ufvkSyncInFlight.set(ufvk, promise);
  return promise;
}

async function _syncUfvkTransactionsImpl(ufvk, opts = {}) {
  const dir = walletDirForUfvk(ufvk);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const data = await zingoCmdForUfvk(ufvk, dir, "messages", opts);
  const raw = Array.isArray(data) ? data : (data?.value_transfers ?? []);

  const txs = raw
    .filter((t) => t && typeof t === "object")
    .map((t) => {
      const memo = pickMemo(t, "") ?? null;
      const kind = String(t.kind ?? t.direction ?? "").toLowerCase();
      const direction = /out|sent/.test(kind) ? "out" : "in";
      const amountRaw = t.amount ?? t.value ?? t.zatoshis ?? 0;
      return {
        txid: t.txid ?? t.tx_id ?? t.transaction_id ?? t.id ?? "",
        direction,
        amountZatoshi: zatoshiString(amountRaw),
        memo,
        counterparty: t.recipient_address ?? t.from_address ?? null,
        blockHeight: t.block_height ?? t.height ?? t.blockheight ?? null,
        timestamp: t.datetime
          ? (t.datetime > 1e12 ? t.datetime : t.datetime * 1000)
          : null,
        status: t.status ?? "confirmed",
        poolReceived: t.pool_received ?? t.pool ?? null,
      };
    })
    .filter((t) => t.txid);

  // Skip the `height`/`info` follow-up calls: each invocation re-runs a
  // full --waitsync, which would triple the work and OOM a 2GB VPS.
  return {
    transactions: txs,
    syncedToBlock: null,
    chainTip: null,
    walletBirthday: null,
    syncedAt: new Date().toISOString(),
  };
}

function pickMemo(t, address) {
  // zingo-cli v0.2 puts memos in `{ memos: [string, ...] }`. Older builds
  // and per-pool note shapes are checked as fallbacks.
  if (Array.isArray(t.memos)) {
    for (const m of t.memos) {
      if (typeof m === "string" && m.length > 0) return m;
    }
  }
  if (typeof t.memo === "string" && t.memo.length > 0) return t.memo;
  if (typeof t.message === "string" && t.message.length > 0) return t.message;
  if (typeof t.text === "string" && t.text.length > 0) return t.text;
  for (const pool of ["sapling_notes", "orchard_notes", "outgoing_metadata"]) {
    const notes = t[pool];
    if (!Array.isArray(notes)) continue;
    for (const n of notes) {
      if (n?.recipient_address && n.recipient_address !== address) continue;
      const memo = typeof n?.memo === "string" ? n.memo : null;
      if (memo && memo.length > 0) return memo;
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");

  if (req.method === "GET" && req.url === "/health") {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, version: "0.1.0", zingo: ZINGO }));
    return;
  }

  if (req.method === "POST" && (req.url === "/memos" || req.url === "/transactions")) {
    if (!checkAuth(req)) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const parsed = await readJsonBody(req, res);
    if (!parsed) return;

    if (req.url === "/memos") {
      const address = typeof parsed.address === "string" ? parsed.address.trim() : "";
      const limit = Math.min(Math.max(parseInt(parsed.limit ?? 50, 10) || 50, 1), 200);
      if (!address) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "address required" }));
        return;
      }
      try {
        const memos = await listIncomingMemos(address, limit);
        res.statusCode = 200;
        res.end(JSON.stringify({ memos }));
      } catch (err) {
        console.error(`[lightwallet-rpc] /memos failed:`, err);
        res.statusCode = 502;
        res.end(JSON.stringify({ error: `zingo-cli failed: ${err.message}` }));
      }
      return;
    }

    if (req.url === "/transactions") {
      const ufvk = typeof parsed.ufvk === "string" ? parsed.ufvk.trim() : "";
      if (!ufvk || !(ufvk.startsWith("uview") || ufvk.startsWith("uviewtest"))) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "ufvk required, must start with uview... or uviewtest..." }));
        return;
      }
      const birthday = parsed.birthday != null ? Number(parsed.birthday) : undefined;
      try {
        const result = await syncUfvkTransactions(ufvk, { birthday });
        res.statusCode = 200;
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error(`[lightwallet-rpc] /transactions failed:`, err);
        res.statusCode = 502;
        res.end(JSON.stringify({ error: `sync failed: ${err.message}` }));
      }
      return;
    }
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

function checkAuth(req) {
  const provided = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (provided.length !== TOKEN_BUF.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), TOKEN_BUF);
  } catch {
    return false;
  }
}

async function readJsonBody(req, res) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) {
      res.statusCode = 413;
      res.end(JSON.stringify({ error: "body too large" }));
      return null;
    }
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "invalid JSON" }));
    return null;
  }
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[lightwallet-rpc] listening on 127.0.0.1:${PORT}`);
  console.log(`[lightwallet-rpc] front with nginx + certbot for TLS.`);
  console.log(`[lightwallet-rpc] token length: ${TOKEN.length} chars (kept on server only).`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
