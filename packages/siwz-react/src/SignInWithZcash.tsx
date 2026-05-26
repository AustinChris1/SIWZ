import { useEffect, useState } from "react";
import { useSiwz, type UseSiwzOptions } from "./useSiwz.js";
import { detectSnapEnvironment, type SnapStatus } from "./snap.js";

export interface SignInWithZcashProps extends UseSiwzOptions {
  /** Button label when idle. Default: "Sign in with Zcash". */
  buttonLabel?: string;
  /** Callback fired on successful sign-in. */
  onSuccess?: () => void;
  /**
   * Enable the MetaMask + Zcash-Snap one-click path. When MetaMask and the
   * Snap are detected the component shows a "Sign in with MetaMask" button
   * as the primary action and the paste flow as a fallback. Default: false
   * (paste-only — works with every wallet today).
   */
  enableSnap?: boolean;
  /** Override the Snap ID. Default: `npm:@chainsafe/webzjs-zcash-snap`. */
  snapId?: string;
  /** Override classNames for fine-grained styling. */
  classNames?: Partial<{
    root: string;
    button: string;
    addressInput: string;
    challenge: string;
    signatureInput: string;
    error: string;
    success: string;
  }>;
}

/**
 * Drop-in "Sign in with Zcash" component.
 *
 * Renders a three-step flow:
 *   1. Address entry — user pastes their Zcash address (t/z/u).
 *   2. Challenge display — the canonical SIWZ message is shown with a
 *      copy button and per-wallet "how to sign" tips. User signs in
 *      their wallet (zcashd CLI, Zodl, Zingo, YWallet, etc.) and
 *      pastes the resulting base64 signature back.
 *   3. Verification — message + signature are posted to the server.
 *
 * Styling is minimal-default. Import `@siwz/react/styles.css` for the
 * polished default look or override via `classNames`.
 */
export function SignInWithZcash(props: SignInWithZcashProps) {
  const {
    buttonLabel = "Sign in with Zcash",
    onSuccess,
    enableSnap = false,
    snapId,
    classNames = {},
    ...siwzOptions
  } = props;

  const s = useSiwz(siwzOptions);
  const [copied, setCopied] = useState(false);
  const [snapEnv, setSnapEnv] = useState<SnapStatus | null>(null);
  const [showPasteFlow, setShowPasteFlow] = useState(!enableSnap);

  useEffect(() => {
    if (!enableSnap) return;
    let cancelled = false;
    detectSnapEnvironment(snapId).then((env) => {
      if (!cancelled) setSnapEnv(env);
    });
    return () => {
      cancelled = true;
    };
  }, [enableSnap, snapId]);

  const cn = (key: keyof NonNullable<typeof classNames>, fallback: string) =>
    classNames[key] ?? fallback;

  if (s.status === "success") {
    if (onSuccess) onSuccess();
    return (
      <div className={cn("root", "siwz-root")}>
        <div className={cn("success", "siwz-success")}>
          ✓ Signed in with Zcash address <code>{shortAddr(s.address)}</code>
        </div>
        <button className={cn("button", "siwz-button siwz-button--secondary")} onClick={s.reset}>
          Sign in with a different address
        </button>
      </div>
    );
  }

  return (
    <div className={cn("root", "siwz-root")}>
      {enableSnap && !showPasteFlow ? (
        <div className="siwz-section">
          <button
            className={cn("button", "siwz-button siwz-button--snap")}
            onClick={async () => {
              const ok = await s.trySnapSignIn(snapId);
              if (!ok) {
                // Snap path failed — surface paste flow so the user has a fallback.
                setShowPasteFlow(true);
              }
            }}
            disabled={s.status === "fetchingNonce" || s.status === "verifying"}
          >
            {s.status === "fetchingNonce" || s.status === "verifying"
              ? "Connecting to MetaMask…"
              : snapEnv?.kind === "snap-not-installed"
              ? "Install Zcash Snap & sign in"
              : snapEnv?.kind === "no-metamask"
              ? "MetaMask not detected — install it"
              : "Sign in with MetaMask"}
          </button>
          {snapEnv?.kind === "no-metamask" ? (
            <p className="siwz-help-note">
              {snapEnv.message}{" "}
              <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                Install MetaMask →
              </a>
            </p>
          ) : (
            <p className="siwz-help-note">
              Connecting to the ChainSafe Zcash Snap reads your viewing key
              (read-only — no spend access). MetaMask will ask you to approve.
            </p>
          )}
          <button
            className="siwz-link-btn"
            type="button"
            onClick={() => setShowPasteFlow(true)}
          >
            Use a different wallet (Zodl, Zingo, YWallet, zcashd) instead →
          </button>
        </div>
      ) : null}

      {(showPasteFlow || !enableSnap) && (
      <>
      <label className="siwz-label">
        Zcash address
        <input
          className={cn("addressInput", "siwz-input")}
          type="text"
          value={s.address}
          onChange={(e) => s.setAddress(e.target.value)}
          placeholder="t1… or zs… or u1…"
          disabled={s.status !== "addressEntry" && s.status !== "error"}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      {!s.message ? (
        <button
          className={cn("button", "siwz-button")}
          onClick={s.buildChallenge}
          disabled={!s.isAddressValid || s.status === "fetchingNonce"}
        >
          {s.status === "fetchingNonce" ? "Preparing challenge…" : buttonLabel}
        </button>
      ) : (
        <>
          <div className="siwz-section">
            <div className="siwz-section-header">
              <strong>Step 1:</strong> Sign this message in your wallet
              <button
                className="siwz-copy-btn"
                onClick={async () => {
                  await navigator.clipboard.writeText(s.message!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className={cn("challenge", "siwz-challenge")}>{s.message}</pre>
          </div>

          <details className="siwz-help">
            <summary>How do I sign this?</summary>
            <p className="siwz-help-note">
              SIWZ uses the standard Zcash <em>signmessage</em> wire format,
              so any wallet that can sign a message will produce a valid
              signature. Find your wallet's <em>Sign Message</em> feature
              (sometimes under Advanced or Tools), paste the address and the
              full challenge above, and copy back the base64 signature.
            </p>
            <ul className="siwz-help-list">
              <li>
                <strong>zcashd / zcash-cli:</strong>{" "}
                <code>{`zcash-cli signmessage "${s.address}" "<paste message>"`}</code>
              </li>
              <li>
                <strong>Zodl, Zingo, YWallet:</strong> look for "Sign Message" in the wallet menu (exact path varies by version).
              </li>
              <li>
                <strong>Unified address holders:</strong> sign with the transparent receiver inside your UA — most wallets surface it as a sub-address.
              </li>
            </ul>
          </details>

          <details className="siwz-help">
            <summary>Why do I have to paste my address first?</summary>
            <p className="siwz-help-note">
              The address is part of the message you're signing — the server
              needs to know which address to verify against, and the wallet
              needs to know which key to sign with. There's no standard
              browser-to-wallet bridge for Zcash (yet), so the SDK can't
              "open your wallet" the way WalletConnect does for Ethereum.
              When wallets ship a SIWZ-aware URI handler, this step
              disappears.
            </p>
          </details>

          <div className="siwz-section">
            <label className="siwz-label">
              <strong>Step 2:</strong> Paste the signature
              <textarea
                className={cn("signatureInput", "siwz-textarea")}
                value={s.signature}
                onChange={(e) => s.setSignature(e.target.value)}
                placeholder="Hxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx="
                rows={4}
                spellCheck={false}
              />
            </label>

            <button
              className={cn("button", "siwz-button")}
              onClick={s.submitSignature}
              disabled={!s.signature.trim() || s.status === "verifying"}
            >
              {s.status === "verifying" ? "Verifying…" : "Verify & Sign in"}
            </button>
          </div>
        </>
      )}
      </>
      )}

      {s.error && (
        <div className={cn("error", "siwz-error")} role="alert">
          {s.error}
        </div>
      )}
    </div>
  );
}

function shortAddr(a: string): string {
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}
