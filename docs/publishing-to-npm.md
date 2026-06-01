# Publishing SIWZ to npm

The three public packages are already set up to publish:

| Package | Path |
|---|---|
| `@siwz/core` | `packages/siwz-core` |
| `@siwz/react` | `packages/siwz-react` |
| `@siwz/next-auth` | `packages/siwz-next-auth` |

Each has `publishConfig: { access: "public" }` so they go to the public registry, and each builds to `dist/` before publishing.

## One-time setup

1. **Pick the npm org.** `@siwz` is currently a placeholder. Either:
   - Register the `siwz` org at npmjs.com (free for public packages), or
   - Rename the packages to your own org (e.g. `@your-handle/siwz-core`). Search-replace `@siwz/` across the monorepo's `package.json`s and TS imports.
2. **Log in.** `npm login` once on the machine that will publish.
3. **Two-factor auth.** Recommended on the org. npm will prompt for an OTP on each publish.

## Workflow per release

From the repo root:

```bash
# 1. Make sure everything is green
pnpm install --frozen-lockfile
pnpm --filter @siwz/core build
pnpm -r typecheck
pnpm --filter @siwz/core test

# 2. Bump the version. Independent versions are fine; bump only what changed.
#    Each command updates the package's package.json + creates a git tag.
pnpm --filter @siwz/core version patch        # 0.2.2 → 0.2.3
pnpm --filter @siwz/react version patch       # only if react changed
pnpm --filter @siwz/next-auth version patch   # only if next-auth changed

# 3. Build the dists that will be published
pnpm --filter @siwz/core build
pnpm --filter @siwz/react build
pnpm --filter @siwz/next-auth build

# 4. Publish (each one separately; pnpm honours publishConfig).
pnpm --filter @siwz/core publish --no-git-checks
pnpm --filter @siwz/react publish --no-git-checks
pnpm --filter @siwz/next-auth publish --no-git-checks

# 5. Push the version-bump commits + tags
git push --follow-tags
```

The first publish for a brand-new scope will fail until the org exists. If you see `E404 Scope not found`, register the org first, or change the scope.

## What gets shipped

`pnpm publish` packs everything in the package directory *except* what `.npmignore` (or, if absent, `.gitignore`) excludes. Verify with:

```bash
pnpm --filter @siwz/core publish --dry-run
```

This prints the tarball contents without uploading. Expect `dist/`, `package.json`, `README.md`. Source `src/` is excluded because each package's `package.json` `"files"` whitelists `dist`.

## Deprecation / unpublish

24-hour unpublish window after publish (`npm unpublish @siwz/core@0.2.3`). After that, use `npm deprecate @siwz/core@0.2.3 "use 0.2.4"` instead.

## Automating it with CI

A release-on-tag workflow (skip until you're ready for it):

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ["@siwz/*@v*"]
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions: { id-token: write }  # for npm provenance
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @siwz/core build && pnpm --filter @siwz/react build && pnpm --filter @siwz/next-auth build
      - run: pnpm -r typecheck && pnpm --filter @siwz/core test
      - run: pnpm --filter @siwz/core publish --no-git-checks --provenance
        env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }} }
      - run: pnpm --filter @siwz/react publish --no-git-checks --provenance
        env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }} }
      - run: pnpm --filter @siwz/next-auth publish --no-git-checks --provenance
        env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }} }
```

Requires an `NPM_TOKEN` secret in the repo (npmjs.com → Access Tokens → Granular, write scope on the three packages). The `--provenance` flag attests the tarball was built by this workflow, which shows up as a badge on npmjs.

## What consumers install

Once published:

```bash
pnpm add @siwz/core @siwz/react @siwz/next-auth next-auth
```

A minimal NextAuth setup is in `docs/quickstart.md`; a full multi-flow integration is in [`apps/zecwall/`](../apps/zecwall) (ZecWall) and [`apps/demo/`](../apps/demo) (ZBooks).
