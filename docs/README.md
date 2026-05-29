# SIWZ Docs

**Read first**
- [Why SIWZ exists](./why-siwz.md): the design essay on why memo-challenge beats signmessage on Zcash.
- [Architecture](./architecture.md): packages, layers, the explorer abstraction, deployment shapes. ([SVG diagram](./architecture.svg))
- [Roadmap](./roadmap.md): what is next, including ZIP 304, ZSA-as-identity, wallet-side callbacks, a hosted verifier.

**Build on it (ZBooks reference app)**
- [ZBooks guide](./zbooks-guide.md): what every page does and how to use ZBooks as a viewer, treasurer, or admin (plus auditing a wallet for undocumented transactions).
- [ZBooks payouts](./zbooks-payouts.md): pay contributors in one non-custodial ZIP 321 batch, then auto-reconcile against the treasury viewing key. The "SIWZ in production" story.
- [System workflow](./system-workflow.md): the whole system end to end, for a reviewer reading it cold.

**Integrate**
- [Integration guide](./integration.md): pick a sign-in method (memo, signed message, snap), what to import for each, and how to wire it.
- [Quickstart](./quickstart.md): add Sign in with Zcash to a Next.js app in about five minutes.
- [Specification](./spec.md): the on-wire SIWZ-classic message format and verification algorithm.
- [Memo-challenge](./memo-challenge.md): the Zcash-native sign-in flow that works with every shielded wallet via ZIP 321.
- [Wallet integration](./wallets.md): how users sign in from each major Zcash wallet, with a full feature matrix.

**Deploy**
- [Winning deployment](./winning-deployment.md): shielded sign-in on a $3/mo VPS, end to end on mainnet.
- [Sapling (ZIP 304) verifier](./sapling-wasm.md): wiring up shielded SIWZ-classic sign-in.

**Operate**
- [Security model](./security.md): what is protected, what is not, and operational guidance.
