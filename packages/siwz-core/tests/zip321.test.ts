import { describe, expect, it, beforeAll } from "vitest";
import {
  buildZip321,
  parseZip321,
  zecToZatoshi,
  zatoshiToZec,
  SiwzError,
} from "../src/index.js";
import { deriveMainnetP2pkh, FIXED_PRIV } from "./helpers.js";

let mainnetAddr: string;

beforeAll(() => {
  mainnetAddr = deriveMainnetP2pkh(FIXED_PRIV).address;
});

describe("buildZip321 / parseZip321", () => {
  it("builds the simplest URI (address only)", () => {
    const uri = buildZip321({ address: mainnetAddr });
    expect(uri).toBe(`zcash:${mainnetAddr}`);
  });

  it("builds a URI with amount, memo, label, message", () => {
    const uri = buildZip321({
      address: mainnetAddr,
      amount: "0.0001337",
      memo: "sign-in to ZBooks",
      label: "ZBooks",
      message: "Send to authenticate",
    });
    expect(uri).toMatch(/^zcash:t1/);
    const parsed = parseZip321(uri);
    expect(parsed.address).toBe(mainnetAddr);
    expect(parsed.amount).toBe("0.0001337");
    expect(parsed.memo).toBe("sign-in to ZBooks");
    expect(parsed.label).toBe("ZBooks");
    expect(parsed.message).toBe("Send to authenticate");
  });

  it("memo is base64url (no +, /, =)", () => {
    const uri = buildZip321({ address: mainnetAddr, memo: "hello??" });
    const memo = new URL(uri.replace("zcash:", "https://x/")).searchParams.get("memo")!;
    expect(memo).not.toContain("+");
    expect(memo).not.toContain("/");
    expect(memo).not.toContain("=");
  });

  it("rejects amount with more than 8 fractional digits", () => {
    expect(() => buildZip321({ address: mainnetAddr, amount: "0.123456789" })).toThrow(SiwzError);
  });

  it("normalises trailing zeros and trailing dot", () => {
    const uri = buildZip321({ address: mainnetAddr, amount: "1.0000" });
    expect(parseZip321(uri).amount).toBe("1");
    const uri2 = buildZip321({ address: mainnetAddr, amount: "1.10000" });
    expect(parseZip321(uri2).amount).toBe("1.1");
  });

  it("rejects memo > 512 bytes", () => {
    expect(() => buildZip321({ address: mainnetAddr, memo: "x".repeat(513) })).toThrow(/512/);
  });

  it("rejects URIs not starting with zcash:", () => {
    expect(() => parseZip321("bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toThrow(SiwzError);
  });

  it("rejects invalid address inside zcash: URI", () => {
    expect(() => parseZip321(`zcash:not-a-real-address?amount=1`)).toThrow(SiwzError);
  });

  it("preserves unknown query params in .unknown", () => {
    const uri = `zcash:${mainnetAddr}?amount=0.001&custom=hello&label=X`;
    const parsed = parseZip321(uri);
    expect(parsed.unknown).toEqual({ custom: "hello" });
  });
});

describe("zecToZatoshi / zatoshiToZec", () => {
  it("converts both directions round-trip", () => {
    for (const z of ["0", "0.00000001", "0.0001337", "1", "21000000"]) {
      const round = zatoshiToZec(zecToZatoshi(z));
      expect(round).toBe(z);
    }
  });

  it("handles 21M (Zcash supply cap)", () => {
    expect(zecToZatoshi("21000000")).toBe(2_100_000_000_000_000n);
  });

  it("handles 1 zatoshi", () => {
    expect(zecToZatoshi("0.00000001")).toBe(1n);
  });
});
