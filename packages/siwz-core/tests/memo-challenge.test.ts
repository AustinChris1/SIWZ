import { describe, expect, it, beforeAll } from "vitest";
import { issueMemoChallenge, verifyMemoChallenge, parseZip321, zecToZatoshi } from "../src/index.js";
import { deriveMainnetP2pkh, FIXED_PRIV } from "./helpers.js";

let serviceAddress: string;
const SECRET = "test-secret-must-be-at-least-16-chars";

beforeAll(() => {
  serviceAddress = deriveMainnetP2pkh(FIXED_PRIV).address;
});

describe("issueMemoChallenge / verifyMemoChallenge", () => {
  it("issues a challenge with a ZIP 321 URI and a token", async () => {
    const ch = await issueMemoChallenge({
      secret: SECRET,
      serviceAddress,
      network: "mainnet",
      identity: "user-claimed-id",
    });
    expect(ch.uri).toMatch(/^zcash:t1/);
    expect(ch.token.split(".").length).toBe(2);
    expect(ch.amountZec).toMatch(/^0\.\d+$/);
    expect(BigInt(ch.amountZatoshi)).toBeGreaterThanOrEqual(zecToZatoshi("0.0001"));
    // Amount must stay in dust range: base + 4-digit nonce = ≤ 19999 zatoshi
    // (= 0.00019999 ZEC). Catches the bug where the random range was 2^24.
    expect(BigInt(ch.amountZatoshi)).toBeLessThanOrEqual(zecToZatoshi("0.0002"));
  });

  it("accepts anonymous (no identity) and assigns a server-generated one", async () => {
    const ch = await issueMemoChallenge({
      secret: SECRET, serviceAddress, network: "mainnet",
    });
    const verify = await verifyMemoChallenge({
      secret: SECRET,
      token: ch.token,
      observedAmountZatoshi: ch.amountZatoshi,
      observedRecipient: serviceAddress,
    });
    expect(verify.ok).toBe(true);
    expect(verify.identity).toMatch(/^anon:[0-9a-f]+$/);
  });

  it("amount embedded in URI matches amountZec", async () => {
    const ch = await issueMemoChallenge({
      secret: SECRET,
      serviceAddress,
      network: "mainnet",
      identity: "u",
    });
    const parsed = parseZip321(ch.uri);
    expect(parsed.amount).toBe(ch.amountZec);
    expect(parsed.address).toBe(serviceAddress);
  });

  it("each issuance gets a unique amount (vanishing collision)", async () => {
    const amounts = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const ch = await issueMemoChallenge({
        secret: SECRET, serviceAddress, network: "mainnet", identity: "u",
      });
      amounts.add(ch.amountZec);
    }
    expect(amounts.size).toBe(25);
  });

  it("round-trip verify succeeds with matching observation", async () => {
    const ch = await issueMemoChallenge({
      secret: SECRET, serviceAddress, network: "mainnet", identity: "alice@zbooks",
    });
    const result = await verifyMemoChallenge({
      secret: SECRET,
      token: ch.token,
      observedAmountZatoshi: ch.amountZatoshi,
      observedRecipient: serviceAddress,
    });
    expect(result.ok).toBe(true);
    expect(result.identity).toBe("alice@zbooks");
  });

  it("rejects when amount differs by even 1 zatoshi", async () => {
    const ch = await issueMemoChallenge({
      secret: SECRET, serviceAddress, network: "mainnet", identity: "u",
    });
    const off = (BigInt(ch.amountZatoshi) + 1n).toString();
    const result = await verifyMemoChallenge({
      secret: SECRET,
      token: ch.token,
      observedAmountZatoshi: off,
      observedRecipient: serviceAddress,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("AMOUNT_MISMATCH");
  });

  it("rejects when recipient address differs", async () => {
    const ch = await issueMemoChallenge({
      secret: SECRET, serviceAddress, network: "mainnet", identity: "u",
    });
    const other = deriveMainnetP2pkh(new Uint8Array(32).fill(8)).address;
    const result = await verifyMemoChallenge({
      secret: SECRET,
      token: ch.token,
      observedAmountZatoshi: ch.amountZatoshi,
      observedRecipient: other,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("RECIPIENT_MISMATCH");
  });

  it("rejects on HMAC mismatch (forged token)", async () => {
    const ch = await issueMemoChallenge({
      secret: SECRET, serviceAddress, network: "mainnet", identity: "u",
    });
    const [payload, _sig] = ch.token.split(".");
    const tampered = `${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    const result = await verifyMemoChallenge({
      secret: SECRET,
      token: tampered,
      observedAmountZatoshi: ch.amountZatoshi,
      observedRecipient: serviceAddress,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("BAD_SIGNATURE");
  });

  it("rejects expired challenges", async () => {
    const ch = await issueMemoChallenge({
      secret: SECRET, serviceAddress, network: "mainnet", identity: "u",
      ttlSeconds: 1,
    });
    const future = new Date(Date.now() + 5_000);
    const result = await verifyMemoChallenge({
      secret: SECRET,
      token: ch.token,
      observedAmountZatoshi: ch.amountZatoshi,
      observedRecipient: serviceAddress,
      now: future,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("EXPIRED");
  });
});
