// Cross-runtime explorer helpers for memo-challenge sign-in.
// Pure fetch; no Node-only deps.

export interface RecentOutput {
  txid: string;
  address: string;
  amountZatoshi: bigint;
  blockHeight?: number;
  blockTime?: number;
}

export interface RecentMemo {
  txid: string;
  memo: string;
  amountZatoshi: bigint;
  blockHeight?: number;
  blockTime?: number;
}

export interface MemoExplorer {
  /** Transparent outputs paid to `address`. Required for transparent-amount sign-in. */
  getRecentOutputsToAddress?(address: string, limit?: number): Promise<RecentOutput[]>;
  /** Decrypted shielded notes; requires an IVK-holding backend. */
  getRecentMemosToAddress?(address: string, limit?: number): Promise<RecentMemo[]>;
}

export class ExplorerError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ExplorerError";
    this.status = status;
  }
}

export interface BlockchairExplorerOptions {
  /** Optional Blockchair API key. Raises the public rate limit. */
  apiKey?: string;
  /** Override the API base URL. Default: https://api.blockchair.com/zcash */
  baseUrl?: string;
  /** Dependency-injection slot for tests and custom runtimes. Default: globalThis.fetch */
  fetch?: typeof fetch;
}

interface BlockchairOutputsResponse {
  data?: Array<{
    transaction_hash: string;
    recipient: string;
    value: number | string;
    block_id?: number | null;
    time?: string | null;
  }>;
}

/** Blockchair-backed transparent-output explorer. Public chain only;
 *  no shielded memos. */
export class BlockchairExplorer implements MemoExplorer {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BlockchairExplorerOptions = {}) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.blockchair.com/zcash").replace(/\/$/, "");
    const f = opts.fetch ?? (typeof fetch === "function" ? fetch : undefined);
    if (!f) throw new ExplorerError("No global fetch() available; pass opts.fetch.");
    this.fetchImpl = f;
  }

  async getRecentOutputsToAddress(address: string, limit = 50): Promise<RecentOutput[]> {
    const url = new URL(`${this.baseUrl}/outputs`);
    url.searchParams.set("q", `recipient(${address})`);
    url.searchParams.set("limit", String(Math.min(Math.max(1, limit), 100)));
    if (this.apiKey) url.searchParams.set("key", this.apiKey);

    const res = await this.fetchImpl(url.toString(), {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new ExplorerError(`Blockchair outputs query returned ${res.status}`, res.status);
    }
    const json = (await res.json()) as BlockchairOutputsResponse;
    return (json.data ?? []).map((row) => ({
      txid: row.transaction_hash,
      address: row.recipient,
      amountZatoshi: BigInt(row.value),
      blockHeight: row.block_id ?? undefined,
      blockTime: row.time ? new Date(`${row.time}Z`).getTime() : undefined,
    }));
  }
}
