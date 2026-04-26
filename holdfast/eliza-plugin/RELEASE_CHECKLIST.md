# @holdfastprotocol/eliza-plugin v0.1.0-devnet.1 Release Checklist

Publish tag: `devnet`
Target: `npm publish --tag devnet` (NOT `--tag latest` or no tag)

> **dist-tag policy:** The `latest` dist-tag is npm-mandatory and cannot be removed once set. If set unintentionally, the deprecation warning (`PREAUDIT_WARNING`) is the intended mitigation for pre-audit packages. Future releases MUST use `npm publish --tag devnet` — never `--tag latest` or no tag.

**Prerequisite:** `@holdfastprotocol/sdk@0.2.0-devnet.1` must be published first (tracked in [CAS-120](/CAS/issues/CAS-120)).

---

## 1. Pre-build verification

- [ ] `@holdfastprotocol/sdk@0.2.0-devnet.1` is live on npm (`npm info @holdfastprotocol/sdk dist-tags`)
- [ ] All source compiles clean: `npm run typecheck` exits 0
- [ ] No uncommitted changes to `eliza-plugin/src/` or `eliza-plugin/package.json`
- [ ] Confirm version in `package.json` is exactly `0.1.0-devnet.1`

## 2. Build

- [ ] Run `npm run build` inside `holdfast/eliza-plugin/`
- [ ] `dist/index.js` exists and is ES module syntax (`export {`)
- [ ] `dist/index.d.ts` declares `createHoldfastPlugin` and `HoldfastPluginConfig`

## 3. Smoke test (optional but recommended)

```js
// In a temp dir with @elizaos/core and @holdfastprotocol/sdk installed:
import { createHoldfastPlugin } from "./dist/index.js";
const plugin = createHoldfastPlugin({});
console.log(plugin.name);   // "holdfast-protocol"
console.log(plugin.actions.map(a => a.name));
```

## 4. Pack dry-run

```sh
cd holdfast/eliza-plugin
npm pack --dry-run
```

Verify tarball includes:
- `dist/index.js`
- `dist/index.d.ts`
- `README.md` (if present)
- `CHANGELOG.md`

Verify tarball does NOT include:
- `src/`
- `tsconfig.json`

## 5. npm publish

```sh
cd holdfast/eliza-plugin
npm publish --tag devnet --access public
```

- [ ] Confirm exit 0 with `+ @holdfastprotocol/eliza-plugin@0.1.0-devnet.1`

## 6. Post-publish verification

```sh
npm info @holdfastprotocol/eliza-plugin dist-tags
# Expected: { devnet: '0.1.0-devnet.1' }
# Must NOT show: latest: '0.1.0-devnet.1'
```

## 7. Notify

- [ ] Post completion comment on [CAS-136](/CAS/issues/CAS-136) with npm link
- [ ] Comment on [CAS-129](/CAS/issues/CAS-129) with npm package URL so DevRel can open the elizaos-plugins registry PR

---

## Security reminders

- **Do not** remove `PREAUDIT_WARNING` before audit sign-off.
- **`latest` dist-tag is npm-mandatory** and cannot be removed once set. Deprecation warning is the intended mitigation for pre-audit packages.
- **Future releases MUST use** `npm publish --tag devnet` — never `--tag latest` or no tag.
- Audit readiness tracked on [CAS-59](/CAS/issues/CAS-59).
