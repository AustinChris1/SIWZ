# `@siwz/react`

Drop-in React component and hook for Sign in with Zcash.

## Install

```bash
npm i @siwz/react @siwz/core
```

## Use

```tsx
import { SignInWithZcash } from "@siwz/react";
import "@siwz/react/styles.css";

<SignInWithZcash
  domain={window.location.host}
  uri={window.location.origin}
  network="mainnet"
  statement="Sign in to MyApp."
  getNonce={async () => {
    const r = await fetch("/api/siwz/nonce", { cache: "no-store" });
    const { nonce, token } = await r.json();
    sessionStorage.setItem("siwz:token", token); // stash to send back later
    return nonce;
  }}
  submit={async ({ message, signature }) => {
    const nonceToken = sessionStorage.getItem("siwz:token") ?? "";
    const result = await signIn("siwz", { message, signature, nonceToken, redirect: false });
    return result?.ok ? { ok: true } : { ok: false, error: result?.error ?? "Sign-in failed" };
  }}
/>
```

## Headless: `useSiwz()`

If you want full control of the markup, drive the same state machine yourself:

```tsx
const s = useSiwz({ domain, uri, network, getNonce, submit });

s.status            // "addressEntry" | "fetchingNonce" | "awaitingSignature" | "verifying" | "success" | "error"
s.address           // user's typed address
s.setAddress(addr)  // controlled input
s.isAddressValid    // boolean — passes parseAddress()
s.buildChallenge()  // step 1: validate + fetch nonce + build SIWZ message
s.message           // the built challenge (display this for the user to sign)
s.signature         // user-pasted signature
s.setSignature(sig)
s.submitSignature() // step 2: post to server for verification
s.error             // string | null
s.reset()
```

## Styling

The default stylesheet uses CSS variables for theming. Override the accent and you're done:

```css
.siwz-root {
  --siwz-accent: #00ffd1;
  --siwz-accent-fg: #000;
}
```

Or skip the stylesheet entirely and pass `classNames` to wire up your own Tailwind / CSS-in-JS classes per slot (root, button, addressInput, challenge, signatureInput, error, success).

## What the user sees

1. **Address entry:** paste your `t1…` / `zs…` / `u1…` address.
2. **Challenge:** a copy-friendly SIWZ message + per-wallet "how to sign" tips (zcash-cli, Zodl, Zingo, YWallet).
3. **Paste signature:** drop in the base64 signature from your wallet.
4. **Verify:** the SDK posts `{message, signature}` to your `submit` handler.
