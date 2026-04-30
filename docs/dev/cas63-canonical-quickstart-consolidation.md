# CAS-63 Canonical Quickstart Consolidation Proposal

## Goal Alignment
- Goal: developer onboarding
- Success condition: deliver a concrete quickstart drift matrix across repo docs, docs app, and runnable example, with a recommended single source of truth and sync workflow.

## Scope Reviewed
- `docs/dev/quickstart.md` (repo docs source)
- `holdfast/docs/quickstart.md` (holdfast package docs)
- `app/docs/quickstart/page.tsx` (website/docs app page)
- `holdfast/sdk/examples/quickstart.ts` (runnable example)
- `examples/holdfast-quickstart/README.md` (forkable example app guide)

## Drift Matrix

| Topic | docs/dev/quickstart.md | holdfast/docs/quickstart.md | app/docs/quickstart/page.tsx | sdk/examples/quickstart.ts | Drift Risk |
|---|---|---|---|---|---|
| Install command | `@holdfastprotocol/sdk@devnet` + `@noble/curves` | `@holdfastprotocol/sdk@devnet` only | `@holdfastprotocol/sdk` (no `@devnet`) | N/A | High: app page implies non-devnet/stable path |
| Time estimate | "under 15 minutes" | "under 15 minutes" | "under 5 minutes" | Multi-part walkthrough | Medium: expectation mismatch |
| Step ordering | install -> fund -> register -> lifecycle | install -> read reputation -> setup wallet -> create pact -> keeper notes | install -> read rep -> register -> create -> deposit -> gate | read rep -> register -> create -> readback | Medium: onboarding confusion |
| Timed pact keeper requirement | Not present | Explicitly documented (required for timed auto-release) | Not present | Not present | High: timed users may assume auto-release runs itself |
| Registration snippet correctness | Uses keypair file + persists p256 key | Uses keypair file + explains signature idempotency | Uses `bs58` env private key snippet; does not install `bs58` in prereqs | Runtime registration built-in | Medium: app snippet may fail copy/paste |
| Amount examples | USDC 1_000_000n + full lifecycle | wSOL 10_000n minimal devnet self-pact | 1 SOL sample amount | wSOL 10_000n minimal | Low: examples vary, but can be normalized by intent labels |
| Lifecycle completeness | create -> deposit -> stake -> lock -> release -> claim | create + read + keeper + next steps | create + deposit only | create + readback; ends before deposit | Medium: different "quickstart done" definition |
| Devnet/pre-audit messaging | Explicit status banner + security link | explicit warning | explicit warning | explicit warning | Low |

## Recommended Canonical Source of Truth

Adopt **`holdfast/sdk/examples/quickstart.ts` + `holdfast/docs/quickstart.md`** as the canonical pair:

- `holdfast/sdk/examples/quickstart.ts` is executable truth for API shape and minimum working flow.
- `holdfast/docs/quickstart.md` is canonical narrative guide tied to the same flow, and already includes critical timed-keeper guidance.

Then treat other surfaces as synchronized derivatives:

- `docs/dev/quickstart.md`: mirror canonical narrative with minimal framing differences only.
- `app/docs/quickstart/page.tsx`: render a shortened version generated from canonical sections/snippets; do not maintain independent code snippets manually.

## Consolidation Rules (Proposed)

1. **Canonical ownership**
- Owner: SDK/docs maintainers
- Canonical files: `holdfast/docs/quickstart.md` and `holdfast/sdk/examples/quickstart.ts`

2. **Single-flow definition**
- "Quickstart complete" means: reputation read + AgentWallet registration + create pact + readback.
- Advanced lifecycle operations (deposit/stake/lock/release/claim, keeper) stay in clearly marked "next steps" or "advanced" sections.

3. **Snippet sourcing rule**
- Any snippet shown in `app/docs/quickstart/page.tsx` must exist verbatim in canonical markdown or be imported from generated snippet artifacts.
- No hand-maintained app-only API snippets.

4. **Devnet posture rule**
- All install commands in quickstart surfaces use `@holdfastprotocol/sdk@devnet` until audit gate changes.

5. **Drift gate in CI**
- Add a lightweight check that fails if key quickstart markers diverge across canonical and mirrors:
  - install tag (`@devnet`)
  - presence of `registerAgentWallet`
  - presence of timed keeper warning text
  - declared expected duration label

## Implementation Sequence

1. Normalize app quickstart copy to canonical install tag and duration language.
2. Add timed-keeper warning section to app quickstart (or explicit link to canonical timed section).
3. Align `docs/dev/quickstart.md` to canonical structure (or convert into thin wrapper that links canonical).
4. Add CI drift check script for required markers.
5. Add contribution note: "edit canonical quickstart first" in docs contributor guide.

## Smallest Verification for This Pass
- Verified drift claims by directly comparing:
  - `docs/dev/quickstart.md`
  - `holdfast/docs/quickstart.md`
  - `app/docs/quickstart/page.tsx`
  - `holdfast/sdk/examples/quickstart.ts`
- Confirmed app docs currently diverge on install tag (`@holdfastprotocol/sdk` vs `@holdfastprotocol/sdk@devnet`) and missing timed keeper guidance.

## Next Action
- Apply sequence step 1 and 2 in CAS-63 implementation patch: update app quickstart install command, duration copy, and timed-keeper guidance to match canonical devnet onboarding posture.

## Continuation Audit (Example App README)

`examples/holdfast-quickstart/README.md` originally carried a conflicting
runtime expectation (`under 5 minutes`). It has now been aligned to
`under 15 minutes` and now includes an explicit timed-mode keeper note so users
do not infer background auto-release behavior.
