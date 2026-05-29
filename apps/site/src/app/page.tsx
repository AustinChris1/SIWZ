import type { ReactNode } from "react";

const GITHUB = "https://github.com";
const NPM = "https://www.npmjs.com/package/@siwz/core";
const ZBOOKS = "https://zecbooks.vercel.app";
const ZECWALL = "https://zecwall.vercel.app";

export default function Home() {
  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <a className="brand" href="#top">
            <Logo /> SIWZ
          </a>
          <div className="nav-links">
            <a className="hide-sm" href="#flows">Flows</a>
            <a className="hide-sm" href="#start">Quickstart</a>
            <a className="hide-sm" href="#apps">Apps</a>
            <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
          </div>
        </div>
      </nav>

      <header className="hero container" id="top">
        <span className="eyebrow"><span className="dot" /> Open auth for Zcash</span>
        <h1>Sign in with <span className="y">Zcash</span>.</h1>
        <p className="lead">
          The auth primitive Zcash didn't have. Non-custodial sign-in that works with
          every wallet, because proving you can send a shielded payment is proving you
          own the wallet.
        </p>
        <p className="sub">
          No seed phrase pasted into a website, no signmessage support required, no
          password to leak. Three npm packages, ten lines of code.
        </p>
        <div className="cta">
          <a className="btn btn-primary" href="#start">Get started</a>
          <a className="btn btn-ghost" href={GITHUB} target="_blank" rel="noreferrer">View on GitHub</a>
        </div>
        <div className="install"><span className="pfx">$</span> pnpm add @siwz/core @siwz/react @siwz/next-auth</div>
      </header>

      <section id="flows">
        <div className="container">
          <div className="section-head">
            <h2>Three ways to sign in, one verifier</h2>
            <p>Every flow ends in a single session. The user picks whichever their wallet supports.</p>
          </div>
          <div className="grid grid-3">
            <Card tag="Recommended" title="Memo challenge">
              Send a tiny shielded payment carrying a one-time memo. Works with every Zcash
              wallet through ZIP 321. No signmessage feature needed.
            </Card>
            <Card tag="Power users" title="Signed message">
              Paste a wallet signature over a magic-prefixed challenge, for wallets that
              expose signmessage like zcash-cli and YWallet.
            </Card>
            <Card tag="One click" title="MetaMask Snap">
              Authenticate with the ChainSafe Zcash Snap. The dApp reads a viewing key and a
              stable account id. No QR, no fee.
            </Card>
          </div>
        </div>
      </section>

      <section id="start">
        <div className="container">
          <div className="section-head">
            <h2>Drop it into a Next.js app</h2>
            <p>A NextAuth provider on the server, one component on the client. That is the whole integration.</p>
          </div>
          <pre>{CODE}</pre>
        </div>
      </section>

      <section id="apps">
        <div className="container">
          <div className="section-head">
            <h2>Two reference apps, one primitive</h2>
            <p>Both consume the same @siwz/* packages. That is the point: SIWZ is a primitive, not a framework.</p>
          </div>
          <div className="grid grid-2">
            <a className="card link" href={ZBOOKS} target="_blank" rel="noreferrer">
              <div className="tag">Production shape</div>
              <h3>ZBooks <span className="arrow">&rarr;</span></h3>
              <p>
                Accounting and payroll for shielded ZEC teams. Viewing-key books, batch
                payouts, P&amp;L and CSV exports. Real SIWZ in real product code.
              </p>
            </a>
            <a className="card link" href={ZECWALL} target="_blank" rel="noreferrer">
              <div className="tag">~150 lines</div>
              <h3>ZecWall <span className="arrow">&rarr;</span></h3>
              <p>
                A Zcash-gated comments wall. The minimal integration: if you can build this
                on a Saturday, SIWZ is real infrastructure.
              </p>
            </a>
          </div>
        </div>
      </section>

      <section id="packages">
        <div className="container">
          <div className="section-head">
            <h2>Three packages</h2>
            <p>Layered and independently usable. Pure TypeScript core, no Node-only deps, 59 tests.</p>
          </div>
          <div className="grid grid-3">
            <Card title="@siwz/core">
              Message format, ZIP 321 builder, address parsing, memo-challenge, and pure-TS verification.
            </Card>
            <Card title="@siwz/react">
              {"<SignInWithZcash />, <MemoSignIn />, the useSiwz() hook, QR and polling, Snap detection."}
            </Card>
            <Card title="@siwz/next-auth">
              A NextAuth credentials provider plus stateless HMAC nonce tokens for serverless.
            </Card>
          </div>
        </div>
      </section>

      <footer>
        <div className="container foot-row">
          <div>Sign in with Zcash. Built for the Zechub hackathon. MIT licensed.</div>
          <div className="nav-links">
            <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
            <a href={NPM} target="_blank" rel="noreferrer">npm</a>
            <a href={ZBOOKS} target="_blank" rel="noreferrer">ZBooks</a>
            <a href={ZECWALL} target="_blank" rel="noreferrer">ZecWall</a>
          </div>
        </div>
      </footer>
    </>
  );
}

function Card({ tag, title, children }: { tag?: string; title: string; children: ReactNode }) {
  return (
    <div className="card">
      {tag ? <div className="tag">{tag}</div> : null}
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

const CODE = `// app/api/auth/[...nextauth]/route.ts  (server)
import { SiwzProvider } from "@siwz/next-auth";
export const authOptions = { providers: [ SiwzProvider({ domain: "myapp.com" }) ] };

// SignIn.tsx  (client)
import { SignInWithZcash } from "@siwz/react";

<SignInWithZcash
  domain="myapp.com" uri="https://myapp.com" network="mainnet"
  getNonce={() => fetch("/api/siwz/nonce").then(r => r.json()).then(j => j.nonce)}
  submit={({ message, signature }) => signIn("siwz", { message, signature })}
/>;`;

function Logo() {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="SIWZ">
      <rect x="6" y="6" width="52" height="52" rx="14" fill="#f4b728" />
      <path d="M22 22H42L22 42H42" stroke="#1a1a1a" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
