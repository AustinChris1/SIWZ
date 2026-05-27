#!/usr/bin/env node
/**
 * SIWZ lightwallet RPC wrapper.
 *
 * Runs on a small VPS next to a `zingo-cli` lite wallet that's synced to
 * the SIWZ service z-addr. Exposes one HTTP endpoint that ZBooks (or any
 * SIWZ-using app, anywhere) calls to fetch decrypted memos:
 *
 *   POST /memos
 *     Authorization: Bearer <LIGHTWALLET_RPC_TOKEN>
 *     { "address": "zs1…", "limit": 50 }
 *   →
 *     200 { "memos": [{ "txid", "memo", "amountZatoshi", "blockHeight" }] }
 *
 * Why a wrapper and not just expose zingo's gRPC: zingo doesn't ship a
 * public HTTP RPC, it's a CLI. Wrapping it as a tiny stateless HTTP API
 * gives us TLS termination, bearer auth, and structured JSON without
 * touching zingo's process model.
 *
 * Deploy notes:
 *   - LIGHTWALLET_RPC_TOKEN — required; long random string. Anyone who
 *     has it can read memos. Generate with:
 *       node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
 *   - PORT — defaults to 18232. Front with nginx + certbot for TLS.
 *   - ZINGO_CLI_PATH — defaults to `zingo-cli`. Absolute path is safer.
 *   - ZINGO_WALLET_DIR — defaults to ~/.zingo. The directory `zingo-cli
 *     --new` creates. Optional; only needed if you keep it elsewhere.
 *
 * This file is intentionally pure Node — no npm dependencies, no build
 * step — so it boots in 2 seconds and survives any version bump.
 */
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PORT = parseInt(process.env.PORT ?? "18232", 10);
const TOKEN = process.env.LIGHTWALLET_RPC_TOKEN;
const ZINGO = process.env.ZINGO_CLI_PATH ?? "zingo-cli";
const WALLET_DIR = process.env.ZINGO_WALLET_DIR; // optional, for /memos service wallet
// Root dir for per-UFVK wallets created by /transactions. One subdirectory
// per UFVK, keyed by a short hash of the UFVK string so the path stays
// short and the same UFVK reuses its existing sync state across requests.
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

/**
 * Spawn zingo-cli with the given command and return parsed JSON output.
 * zingo-cli is interactive by default; passing a command as the positional
 * argument runs in one-shot mode and exits. (zingo-cli v0.2+ dropped the
 * older `--command <cmd>` flag in favour of `<cmd>` positional.)
 *
 * --waitsync makes the implicit-on-startup sync block command execution
 * until it completes — guarantees the data we return is fresh.
 */
async function zingoCmd(cmd) {
  const baseArgs = WALLET_DIR ? ["--data-dir", WALLET_DIR] : [];
  const args = [...baseArgs, "--waitsync", cmd];
  const { stdout } = await exec(ZINGO, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });
  // zingo-cli wraps JSON output between status lines like "Launching
  // sync task..." and "Zingo CLI quit successfully." A regex on JSON
  // is fragile (especially since the output can end with non-whitespace
  // after the JSON), so walk the string properly: find the first '{'
  // or '[', then count depth (respecting string literals) until the
  // matching close.
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

/**
 * Get the list of incoming memos for a given address.
 *
 * zingo-cli v0.2's `messages` command returns:
 *   { "value_transfers": [ { ...transfer with memo...}, ... ] }
 *
 * We extract memos from incoming transfers. The exact field names per-
 * transfer can shift between versions, so the extraction is defensive
 * about a handful of common keys (memo / message / text; amount / value;
 * txid / tx_id; kind / direction).
 */
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
    // Determine whether incoming. zingo-cli versions vary; some use
    // `kind` ("incoming"/"outgoing"), some use `direction` ("in"/"out"),
    // some only convey it via amount sign. Default to true when none of
    // those are set — `messages` is already filtered to memos so most
    // entries are relevant.
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

/**
 * zingo-cli sometimes reports amounts as integer zatoshi and sometimes
 * as decimal ZEC. Heuristic: integers stay as-is (zatoshi); decimals get
 * multiplied by 1e8. Always returns a string for JSON-safe big numbers.
 */
function zatoshiString(raw) {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1e8));
}

// ----- Per-UFVK transaction sync -----

/**
 * Run a zingo-cli command against a UFVK-specific wallet directory.
 * The wallet dir is created on first call by invoking zingo-cli with
 * `--viewkey` and then a synchronous command (the `--viewkey` flag fails
 * if the wallet already exists, so we only pass it when bootstrapping).
 *
 * Returns parsed JSON from the command's stdout (using extractJsonBlock
 * to skip over zingo-cli's status-line noise).
 */
// Default wallet birthday when the caller doesn't supply one. Roughly
// mid-2024 — every snap-created Zcash wallet exists past this, and
// scanning from here finishes in under a minute on a 2GB VPS. Power
// users with older funds pass an explicit `birthday` in the POST body
// (0 = full chain, 1_687_104 = NU5, 419_200 = Sapling activation).
const DEFAULT_WALLET_BIRTHDAY = 2_400_000;

/**
 * Per-UFVK in-flight sync cache. If a client times out (nginx 504 after
 * 60s) and retries, we'd otherwise spawn a second zingo-cli against the
 * same wallet dir, corrupting it. This dedupes by ufvk: a second call
 * while the first is running joins the first promise instead of
 * starting fresh work.
 */
const ufvkSyncInFlight = new Map();

async function zingoCmdForUfvk(ufvk, walletDir, cmd, opts = {}) {
  const isFresh = !existsSync(join(walletDir, "zingo-wallet.dat"));
  const baseArgs = ["--data-dir", walletDir];
  if (isFresh) {
    // `--viewkey` requires `--birthday` in zingo-cli v0.2 — without it
    // the CLI refuses with a "specify the wallet birthday" error.
    const birthday = Number.isFinite(opts.birthday) ? Math.max(0, Math.floor(opts.birthday)) : DEFAULT_WALLET_BIRTHDAY;
    baseArgs.push("--viewkey", ufvk, "--birthday", String(birthday));
  }
  // --waitsync so the sync that fires at startup blocks the command's
  // execution until it's caught up. Otherwise messages might return a
  // stale snapshot of the wallet's previous state.
  const args = [...baseArgs, "--waitsync", cmd];
  const { stdout, stderr } = await exec(ZINGO, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // First sync from wallet birthday can take a while for an active account
    timeout: 5 * 60_000,
  });
  const block = extractJsonBlock(stdout);
  if (!block) {
    // Surface stderr too — an empty stdout with content on stderr is
    // almost always an invalid UFVK or a command zingo doesn't recognise.
    const stdoutHint = stdout.trim().slice(0, 400) || "(empty)";
    const stderrHint = (stderr || "").trim().slice(0, 400) || "(empty)";
    throw new Error(`zingo "${cmd}" returned no JSON. stdout=${stdoutHint} stderr=${stderrHint}`);
  }
  return JSON.parse(block);
}

/**
 * Hash a UFVK to a short, filesystem-safe wallet dir name. Collision
 * probability is vanishingly small at 16 hex chars (64 bits) and the
 * UFVKs we'd actually see are unique by construction.
 */
function walletDirForUfvk(ufvk) {
  const h = createHash("sha256").update(ufvk).digest("hex").slice(0, 16);
  return join(UFVK_WALLETS_DIR, h);
}

/**
 * Sync a UFVK to current chain tip and return its full value-transfer
 * list, normalised into a shape ZBooks can persist directly.
 *
 * On first call for a given UFVK, this creates a new wallet via
 * `--viewkey` and runs an initial sync. Initial sync can take a few
 * minutes for an active account (a fresh team treasury with hundreds
 * of txs); subsequent calls are incremental and finish in seconds.
 */
async function syncUfvkTransactions(ufvk, opts = {}) {
  // Dedupe concurrent syncs on the same UFVK. nginx's default 60s
  // read-timeout can kill the client connection mid-sync; if the user
  // (or auto-poller) retries, we don't want to spawn a second zingo
  // against the same wallet dir. The retry joins the in-flight promise.
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

  // `messages` is the zingo-cli command that returns decrypted incoming
  // memos and outgoing transfers. The shape varies by version: older
  // versions return a flat array; v0.2+ wraps it as
  // `{ value_transfers: [...] }`. Handle both. `opts.birthday` flows
  // through to `--birthday <N>` on first-wallet bootstrap.
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

  // Each zingo-cli invocation does a *full* sync from birthday because
  // --waitsync blocks until caught up. So calling `messages` + `height`
  // + `info` as three commands triples the work and OOMs a 2GB VPS.
  // We skip the metadata calls — the client renders an indeterminate
  // animated bar when these are null, which is fine UX.
  return {
    transactions: txs,
    syncedToBlock: null,
    chainTip: null,
    walletBirthday: null,
    syncedAt: new Date().toISOString(),
  };
}

function pickMemo(t, address) {
  // zingo-cli v0.2 `messages` shape: { memos: [string, ...] }
  // Take the first non-empty string in the array.
  if (Array.isArray(t.memos)) {
    for (const m of t.memos) {
      if (typeof m === "string" && m.length > 0) return m;
    }
  }
  // Older / alternative shapes — keep as fallbacks.
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

  // --- health ---
  if (req.method === "GET" && req.url === "/health") {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, version: "0.1.0", zingo: ZINGO }));
    return;
  }

  // --- authenticated endpoints share this preamble ---
  if (req.method === "POST" && (req.url === "/memos" || req.url === "/transactions")) {
    if (!checkAuth(req)) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const parsed = await readJsonBody(req, res);
    if (!parsed) return; // readJsonBody already responded

    // --- /memos ---
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

    // --- /transactions ---
    // Sync a UFVK to current chain tip and return its full transaction
    // list. First call for a given UFVK is slow (initial wallet sync,
    // can take minutes for an active account); subsequent calls are
    // incremental and finish in seconds.
    //
    // Optional `birthday` in the POST body is the block height to start
    // scanning from. Only consulted on the first call for this UFVK
    // (when the wallet dir is being bootstrapped); ignored after.
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
