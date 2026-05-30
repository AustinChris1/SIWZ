# @siwz/react

[![npm](https://img.shields.io/npm/v/@siwz/react.svg)](https://www.npmjs.com/package/@siwz/react)

Drop-in React component, headless hook, and MetaMask Zcash Snap helpers for **Sign in with Zcash**.

Docs and live demos: <https://siwz.vercel.app>

## Install

```bash
npm i @siwz/react @siwz/core
```

Peer-deps: `react >= 18`.

## What ships

| Export | What it does |
|---|---|
| `<SignInWithZcash />` | Signed-message UI: address input, SIWZ challenge, paste-signature, verify. Optional one-click Snap path via `enableSnap` + `onSnapAuth`. |
| `useSiwz()` | Headless hook backing the same state machine. Render whatever markup you like. |
| `snapConnect`, `snapGetSeedFingerprint`, `snapGetViewingKey`, `detectSnapEnvironment`, ... | Low-level helpers for the ChainSafe MetaMask Zcash Snap. |

## Quickstart

```tsx
import { SignInWithZcash } from "@siwz/react";
import "@siwz/react/styles.css";
import { signIn } from "next-auth/react";

<SignInWithZcash
  domain={window.location.host}
  uri={window.location.origin}
  network="mainnet"
  statement="Sign in to MyApp."
  getNonce={async () => {
    const r = await fetch("/api/siwz/nonce", { cache: "no-store" });
    const { nonce, token } = await r.json();
    sessionStorage.setItem("siwz:token", token);
    return nonce;
  }}
  submit={async ({ message, signature }) => {
    const nonceToken = sessionStorage.getItem("siwz:token") ?? "";
    const result = await signIn("siwz", { message, signature, nonceToken, redirect: false });
    return result?.ok ? { ok: true } : { ok: false, error: result?.error ?? "rejected" };
  }}
/>
```

## Headless: `useSiwz()`

```tsx
import { useSiwz } from "@siwz/react";

const s = useSiwz({ domain, uri, network, getNonce, submit });

s.status            // "addressEntry" | "fetchingNonce" | "awaitingSignature" | "verifying" | "success" | "error"
s.address; s.setAddress(addr);
s.isAddressValid    // boolean per parseAddress()
s.buildChallenge()  // validate + fetch nonce + build SIWZ message
s.message
s.signature; s.setSignature(sig);
s.submitSignature() // post to server
s.error
s.reset()
```

## Memo-challenge UI

The memo-challenge protocol primitives (`issueMemoChallenge`, `verifyMemoChallenge`, the ZIP 321 URI builder) live in [`@siwz/core`](https://www.npmjs.com/package/@siwz/core). The UI is intentionally not bundled here yet, because each app's polling and matching strategy is different (mock vs public explorer vs lightwallet RPC).

Two reference implementations to copy from, both linked from <https://siwz.vercel.app>:

- ZBooks: a full memo flow with auto-reconciliation, dark-mode styling, and accessibility polish.
- ZecWall: the same flow with no extras, written to be readable end-to-end in a single file.

A packaged `<MemoSignIn />` is on the roadmap once a clean polling API stabilises.

## MetaMask Zcash Snap

For accounts using ChainSafe's [Zcash Snap](https://snaps.metamask.io/snap/npm/chainsafe/webzjs-zcash-snap/):

```ts
import {
  detectSnapEnvironment,
  snapConnect,
  type SnapIdentity,
} from "@siwz/react";

const env = await detectSnapEnvironment();
if (env.status === "ready") {
  const id: SnapIdentity = await snapConnect();
  // → { fingerprint, ufvk }
}
```

Or pass `enableSnap` + `onSnapAuth` to `<SignInWithZcash />` to surface it as a one-click button alongside the address flow.

**Heads up:** ChainSafe's published Snap currently restricts RPC calls to `https://webzjs.chainsafe.dev` via `endowment:rpc.allowedOrigins`. Third-party origins are rejected by the Snap manifest until ChainSafe relaxes it or publishes a runtime-prompt variant. Treat Snap as a progressive enhancement, not the primary path. The memo-challenge flow works with every Zcash wallet and has no such restriction.

Helpers exported:

```ts
detectSnapEnvironment, requestSnapInstall
snapConnect, snapGetSeedFingerprint, snapGetViewingKey
findMetaMaskProvider, DEFAULT_SNAP_ID, SnapInvokeError
type SnapStatus, type SnapIdentity, type SnapErrorCode
```

## Styling

Default stylesheet uses CSS variables. Override the accent and you're done:

```css
.siwz-root {
  --siwz-accent: #f4b728;
  --siwz-accent-fg: #1a1a1a;
}
```

Or skip the stylesheet entirely and pass `classNames` to `<SignInWithZcash />` to wire your own Tailwind / CSS-in-JS classes per slot (root, button, addressInput, challenge, signatureInput, error, success).

## Related packages

- [`@siwz/core`](https://www.npmjs.com/package/@siwz/core): protocol primitives.
- [`@siwz/next-auth`](https://www.npmjs.com/package/@siwz/next-auth): NextAuth provider plus stateless HMAC nonces.

## License

MIT
