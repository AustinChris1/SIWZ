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
          <a className="brand" href="#top"><Logo /> SIWZ</a>
          <div className="nav-links">
            <a className="hide-sm" href="#flows">Flows</a>
            <a className="hide-sm" href="#start">Quickstart</a>
            <a className="hide-sm" href="#apps">Apps</a>
            <a className="hide-sm" href="#packages">Packages</a>
            <a className="gh-btn" href={GITHUB} target="_blank" rel="noreferrer"><GithubIcon /> GitHub</a>
          </div>
        </div>
      </nav>

      <header className="hero" id="top">
        <div className="container hero-grid">
          <div className="hero-text reveal">
            <span className="eyebrow"><span className="dot" /> Open auth for Zcash</span>
            <h1>Sign in with <span className="y">Zcash</span>.</h1>
            <p className="lead">
              The auth primitive Zcash didn't have. Non-custodial sign-in that works with
              every wallet, because proving you can send a shielded payment is proving you
              own the wallet.
            </p>
            <div className="cta">
              <a className="btn btn-primary" href="#start">Get started <ArrowIcon /></a>
              <a className="btn btn-ghost" href={GITHUB} target="_blank" rel="noreferrer"><GithubIcon /> View on GitHub</a>
            </div>
            <div className="install"><span className="pfx">$</span>&nbsp;pnpm add @siwz/core @siwz/react @siwz/next-auth</div>
          </div>
          <div className="reveal reveal-1">
            <CodeCard file="app/SignIn.tsx" html={PREVIEW_HTML} />
          </div>
        </div>
      </header>

      <section id="flows">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Sign-in flows</span>
            <h2>Three ways to sign in, one verifier</h2>
            <p>Every flow ends in a single session. The user picks whichever their wallet supports. The server doesn't care which.</p>
          </div>
          <div className="grid grid-3">
            <Card icon={<QrIcon />} tag="Recommended" title="Memo challenge">
              Send a tiny shielded payment carrying a one-time memo. Works with every Zcash
              wallet through ZIP 321. No signmessage feature needed.
            </Card>
            <Card icon={<PenIcon />} tag="Power users" title="Signed message">
              Paste a wallet signature over a magic-prefixed challenge, for wallets that
              expose signmessage like zcash-cli and YWallet.
            </Card>
            <Card icon={<SnapIcon />} tag="One click" title="MetaMask Snap">
              Authenticate with the ChainSafe Zcash Snap. The dApp reads a viewing key and a
              stable account id. No QR, no fee.
            </Card>
          </div>
          <div className="stats">
            <Stat v="3" l="npm packages" />
            <Stat v="59" l="Core tests" />
            <Stat v="5-15s" l="Avg sign-in" />
            <Stat v="MIT" l="Open source" />
          </div>
        </div>
      </section>

      <section id="start">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Quickstart</span>
            <h2>Drop it into a Next.js app</h2>
            <p>A NextAuth provider on the server, one component on the client. That is the whole integration.</p>
          </div>
          <div style={{ marginTop: 36 }}>
            <CodeCard file="app/api/auth + SignIn.tsx" html={FULL_HTML} />
          </div>
        </div>
      </section>

      <section id="apps">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Reference apps</span>
            <h2>Two apps, one primitive</h2>
            <p>Both consume the same @siwz/* packages. That is the point: SIWZ is a primitive, not a framework.</p>
          </div>
          <div className="grid grid-2">
            <a className="card link" href={ZBOOKS} target="_blank" rel="noreferrer">
              <div className="icon"><LedgerIcon /></div>
              <div className="tag">Production shape</div>
              <h3>ZBooks <span className="arrow">&rarr;</span></h3>
              <p>Accounting and payroll for shielded ZEC teams. Viewing-key books, batch payouts, P&amp;L and CSV exports. Real SIWZ in real product code.</p>
            </a>
            <a className="card link" href={ZECWALL} target="_blank" rel="noreferrer">
              <div className="icon"><ChatIcon /></div>
              <div className="tag">Minimal integration</div>
              <h3>ZecWall <span className="arrow">&rarr;</span></h3>
              <p>A Zcash-gated comments wall. The minimal integration: if you can build this on a Saturday, SIWZ is real infrastructure.</p>
            </a>
          </div>
        </div>
      </section>

      <section id="packages">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Packages</span>
            <h2>Three packages, layered</h2>
            <p>Independently usable. Pure TypeScript core, no Node-only deps, 59 tests.</p>
          </div>
          <div className="grid grid-3">
            <Card icon={<BoxIcon />} title="@siwz/core">
              Message format, ZIP 321 builder, address parsing, memo-challenge, and pure-TS verification.
            </Card>
            <Card icon={<ComponentIcon />} title="@siwz/react">
              {"<SignInWithZcash />, <MemoSignIn />, the useSiwz() hook, QR and polling, Snap detection."}
            </Card>
            <Card icon={<PlugIcon />} title="@siwz/next-auth">
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

function Card({ icon, tag, title, children }: { icon?: ReactNode; tag?: string; title: string; children: ReactNode }) {
  return (
    <div className="card">
      {icon ? <div className="icon">{icon}</div> : null}
      {tag ? <div className="tag">{tag}</div> : null}
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div className="stat">
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </div>
  );
}

function CodeCard({ file, html }: { file: string; html: string }) {
  return (
    <div className="code-card">
      <div className="code-head">
        <div className="dots"><span /><span /><span /></div>
        <div className="file">{file}</div>
      </div>
      <pre className="code-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="SIWZ">
      <rect x="6" y="6" width="52" height="52" rx="14" fill="#f4b728" />
      <path d="M22 22H42L22 42H42" stroke="#1a1a1a" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const PREVIEW_HTML = `<span class="c">// drop-in component</span>
<span class="k">import</span> { <span class="t">SignInWithZcash</span> } <span class="k">from</span> <span class="s">"@siwz/react"</span>;

&lt;<span class="t">SignInWithZcash</span>
  <span class="p">domain</span>=<span class="s">"myapp.com"</span>
  <span class="p">uri</span>=<span class="s">"https://myapp.com"</span>
  <span class="p">network</span>=<span class="s">"mainnet"</span>
  <span class="p">getNonce</span>={() =&gt; <span class="fn">fetch</span>(<span class="s">"/api/siwz/nonce"</span>)
    .then(r =&gt; r.json()).then(j =&gt; j.nonce)}
  <span class="p">submit</span>={({ message, signature }) =&gt;
    <span class="fn">signIn</span>(<span class="s">"siwz"</span>, { message, signature })}
/&gt;;`;

const FULL_HTML = `<span class="c">// app/api/auth/[...nextauth]/route.ts  (server)</span>
<span class="k">import</span> { <span class="t">SiwzProvider</span> } <span class="k">from</span> <span class="s">"@siwz/next-auth"</span>;
<span class="k">export const</span> authOptions = {
  <span class="p">providers</span>: [ <span class="fn">SiwzProvider</span>({ <span class="p">domain</span>: <span class="s">"myapp.com"</span> }) ],
};

<span class="c">// SignIn.tsx  (client)</span>
<span class="k">import</span> { <span class="t">SignInWithZcash</span> } <span class="k">from</span> <span class="s">"@siwz/react"</span>;

&lt;<span class="t">SignInWithZcash</span>
  <span class="p">domain</span>=<span class="s">"myapp.com"</span>
  <span class="p">uri</span>=<span class="s">"https://myapp.com"</span>
  <span class="p">network</span>=<span class="s">"mainnet"</span>
  <span class="p">getNonce</span>={() =&gt; <span class="fn">fetch</span>(<span class="s">"/api/siwz/nonce"</span>).then(r =&gt; r.json()).then(j =&gt; j.nonce)}
  <span class="p">submit</span>={({ message, signature }) =&gt; <span class="fn">signIn</span>(<span class="s">"siwz"</span>, { message, signature })}
/&gt;;`;

function ArrowIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>;
}
function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.92.58.1.79-.25.79-.55v-2.03c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.95.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .96-.31 3.16 1.18a10.94 10.94 0 0 1 5.74 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.77 1.05.77 2.12v3.14c0 .3.21.66.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}
function QrIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3z" /><path d="M20 14v3M14 20h3M17 20v1M20 20v1" /></svg>;
}
function PenIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19l7-7 3 3-7 7H9z" /><path d="M19 12l-7 7" /><path d="M2 22l3-3 4 4" /><path d="M14 6l4 4" /></svg>;
}
function SnapIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 2L4 14h7l-1 8L20 10h-7l1-8z" /></svg>;
}
function LedgerIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
}
function ChatIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
}
function BoxIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" /></svg>;
}
function ComponentIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5.5 8.5L9 12l-3.5 3.5L2 12l3.5-3.5zM12 2l3.5 3.5L12 9 8.5 5.5 12 2zM18.5 8.5L22 12l-3.5 3.5L15 12l3.5-3.5zM12 15l3.5 3.5L12 22l-3.5-3.5L12 15z" /></svg>;
}
function PlugIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 22v-5" /><path d="M9 7V2" /><path d="M15 7V2" /><path d="M6 13V8h12v5a6 6 0 0 1-12 0z" /></svg>;
}
