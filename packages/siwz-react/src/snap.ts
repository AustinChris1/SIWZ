/**
 * MetaMask Snap integration for Zcash, targeting the ChainSafe WebZjs
 * Zcash Snap (npm: `@chainsafe/webzjs-zcash-snap`, directory:
 * https://snaps.metamask.io/snap/npm/chainsafe/webzjs-zcash-snap/).
 *
 * IMPORTANT — the Snap does NOT expose a signMessage RPC, so SIWZ-classic
 * (sign-a-challenge-string) cannot run via the Snap. Inspecting the
 * upstream source (packages/snap/src/rpc/* in ChainSafe/WebZjs) the
 * exposed methods are:
 *
 *   getViewingKey         → returns the account's UFVK
 *   getSeedFingerprint    → returns a stable per-seed identifier
 *   signPczt              → signs a Partially Constructed Zcash Tx
 *   setBirthdayBlock      → wallet sync hint
 *   getSnapState/setSnapState → persisted Snap-managed state
 *
 * The right auth pattern for the Snap is therefore PERMISSION-BASED, not
 * signature-based: by approving our dApp's connection to the Snap, the
 * user grants us read access to a stable account identity (the seed
 * fingerprint) and to the account's UFVK. We treat that as authentication
 * for the connecting dApp — exactly like every other Snap-using site does
 * (see e.g. ChainSafe's own webzjs.chainsafe.dev dashboard).
 *
 * This is a different threat model from SIWZ-classic: SIWZ proves spending
 * authority over a specific address via a digital signature, Snap-auth
 * proves "MetaMask approved this site for this account." Apps choosing
 * Snap-auth accept that approval as identity.
 *
 * The two paths coexist in `@siwz/react` — `SignInWithZcash` exposes
 * `onSnapAuth(info)` for the Snap path and `submit({message, signature})`
 * for the SIWZ-classic path. Apps can wire one, both, or neither.
 */

export const DEFAULT_SNAP_ID = "npm:@chainsafe/webzjs-zcash-snap";

interface EthereumProvider {
  isMetaMask?: boolean;
  request: <T = unknown>(args: { method: string; params?: unknown }) => Promise<T>;
}

interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: EthereumProvider;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider & { providers?: EthereumProvider[] };
  }
}

/**
 * Find the MetaMask provider via EIP-6963, even when other wallets
 * (Phantom, Coinbase Wallet, Brave Wallet, Rabby, …) have clobbered
 * `window.ethereum`. Falls back to legacy detection if EIP-6963 yields
 * nothing within a short window.
 */
export async function findMetaMaskProvider(): Promise<EthereumProvider | null> {
  if (typeof window === "undefined") return null;

  const found: EthereumProvider[] = [];
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<Eip6963ProviderDetail>).detail;
    if (!detail) return;
    if (detail.info.rdns === "io.metamask" || detail.info.name === "MetaMask") {
      found.push(detail.provider);
    }
  };
  window.addEventListener("eip6963:announceProvider", handler);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, 150));
  window.removeEventListener("eip6963:announceProvider", handler);

  if (found.length > 0) return found[0] ?? null;

  const eth = window.ethereum;
  if (!eth) return null;
  if (eth.isMetaMask) return eth;
  if (eth.providers && Array.isArray(eth.providers)) {
    const mm = eth.providers.find((p) => p.isMetaMask);
    if (mm) return mm;
  }
  return null;
}

export type SnapStatus =
  | { kind: "no-metamask"; message: string }
  | { kind: "snap-not-installed"; message: string; snapId: string }
  | { kind: "ready"; snapId: string; version: string };

export async function detectSnapEnvironment(snapId: string = DEFAULT_SNAP_ID): Promise<SnapStatus> {
  if (typeof window === "undefined") {
    return { kind: "no-metamask", message: "MetaMask is not available in this environment." };
  }
  const mm = await findMetaMaskProvider();
  if (!mm) {
    return {
      kind: "no-metamask",
      message:
        "MetaMask wasn't found. If you have multiple Ethereum wallets installed (Phantom, Coinbase, Brave, …), one of them may be capturing window.ethereum — try pausing them or set MetaMask as default.",
    };
  }
  let snaps: Record<string, { version: string }> = {};
  try {
    snaps = await mm.request<Record<string, { version: string }>>({
      method: "wallet_getSnaps",
    });
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (/no corresponding handler|method not found|does not support/i.test(msg)) {
      return {
        kind: "no-metamask",
        message:
          "A wallet responded but it doesn't support the MetaMask Snaps API. Confirm MetaMask is the active provider in your browser's wallet picker.",
      };
    }
    return {
      kind: "snap-not-installed",
      message: "Couldn't query installed Snaps. Update MetaMask to the latest version.",
      snapId,
    };
  }
  const installed = snaps[snapId];
  if (!installed) {
    return {
      kind: "snap-not-installed",
      message: `The Zcash Snap isn't installed in this MetaMask yet. Click the button below to install and connect it.`,
      snapId,
    };
  }
  return { kind: "ready", snapId, version: installed.version };
}

export async function requestSnapInstall(snapId: string = DEFAULT_SNAP_ID): Promise<string> {
  const mm = await findMetaMaskProvider();
  if (!mm) throw new Error("MetaMask was not found in this browser.");
  const result = await mm.request<Record<string, { version: string }>>({
    method: "wallet_requestSnaps",
    params: { [snapId]: {} },
  });
  const v = result?.[snapId]?.version;
  if (!v) throw new Error("MetaMask declined to install the Snap.");
  return v;
}

/**
 * Generic Snap-RPC helper. Surfaces friendly errors (user-rejected,
 * method-not-found) so callers can branch on cause.
 */
async function invokeSnap<T = unknown>(snapId: string, method: string, params?: unknown): Promise<T> {
  const mm = await findMetaMaskProvider();
  if (!mm) throw new SnapInvokeError("no-metamask", "MetaMask was not found in this browser.");
  try {
    return await mm.request<T>({
      method: "wallet_invokeSnap",
      params: { snapId, request: { method, params } },
    });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (/reject|denied|cancel/i.test(msg)) {
      throw new SnapInvokeError("user-rejected", "MetaMask request was cancelled.");
    }
    if (/method.*(not found|not supported|unsupported|no corresponding handler)/i.test(msg)) {
      throw new SnapInvokeError("method-unavailable", `The Snap doesn't expose ${method}.`);
    }
    throw new SnapInvokeError("snap-error", msg);
  }
}

export type SnapErrorCode = "no-metamask" | "user-rejected" | "snap-error" | "method-unavailable";

export class SnapInvokeError extends Error {
  readonly code: SnapErrorCode;
  constructor(code: SnapErrorCode, message: string) {
    super(message);
    this.name = "SnapInvokeError";
    this.code = code;
  }
}

/**
 * Ask the Zcash Snap for the connected account's seed fingerprint —
 * a stable per-seed identifier that doesn't expose any spending power.
 * Suitable for use as a deterministic identity.
 */
export async function snapGetSeedFingerprint(snapId: string = DEFAULT_SNAP_ID): Promise<string> {
  const raw = await invokeSnap<unknown>(snapId, "getSeedFingerprint");
  return normaliseFingerprint(raw);
}

/**
 * Ask the Snap for the account's Unified Full Viewing Key (UFVK).
 * Read-only access to all of the account's transactions. Suitable to
 * import into accounting / analytics dApps like ZBooks.
 */
export async function snapGetViewingKey(snapId: string = DEFAULT_SNAP_ID): Promise<string> {
  const raw = await invokeSnap<unknown>(snapId, "getViewingKey");
  return normaliseString(raw, "getViewingKey");
}

export interface SnapIdentity {
  /** Stable per-seed identifier (hex string). */
  fingerprint: string;
  /** Unified Full Viewing Key — read-only, no spend authority. */
  ufvk: string;
  /** The Snap ID this identity came from. */
  snapId: string;
  /** Installed Snap version (informational). */
  snapVersion: string;
}

/**
 * One-call sign-in helper: ensures the Snap is installed (prompting
 * MetaMask to install it if needed), then fetches the identity tuple
 * the app needs.
 *
 * This is the path apps should call from a "Sign in with MetaMask"
 * button — no address entry required.
 */
export async function snapConnect(snapId: string = DEFAULT_SNAP_ID): Promise<SnapIdentity> {
  let env = await detectSnapEnvironment(snapId);
  if (env.kind === "no-metamask") {
    throw new SnapInvokeError("no-metamask", env.message);
  }
  if (env.kind === "snap-not-installed") {
    await requestSnapInstall(env.snapId);
    env = await detectSnapEnvironment(snapId);
    if (env.kind !== "ready") {
      throw new SnapInvokeError("snap-error", env.kind === "snap-not-installed" ? env.message : "Snap install failed.");
    }
  }
  const [fingerprint, ufvk] = await Promise.all([
    snapGetSeedFingerprint(env.snapId),
    snapGetViewingKey(env.snapId),
  ]);
  return { fingerprint, ufvk, snapId: env.snapId, snapVersion: env.version };
}

// ---- helpers ----

function normaliseString(raw: unknown, method: string): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const key of ["value", "result", "data", "ufvk", "viewingKey"]) {
      if (typeof r[key] === "string") return r[key] as string;
    }
  }
  throw new SnapInvokeError("snap-error", `Snap.${method} returned an unexpected shape: ${JSON.stringify(raw)?.slice(0, 120)}`);
}

function normaliseFingerprint(raw: unknown): string {
  if (typeof raw === "string") return raw.startsWith("0x") ? raw.slice(2) : raw;
  if (Array.isArray(raw)) {
    return raw.map((b) => Number(b).toString(16).padStart(2, "0")).join("");
  }
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const key of ["fingerprint", "value", "result", "data"]) {
      if (typeof r[key] === "string") return (r[key] as string).replace(/^0x/, "");
      if (Array.isArray(r[key])) {
        return (r[key] as number[]).map((b) => Number(b).toString(16).padStart(2, "0")).join("");
      }
    }
  }
  throw new SnapInvokeError("snap-error", `Snap.getSeedFingerprint returned an unexpected shape`);
}
