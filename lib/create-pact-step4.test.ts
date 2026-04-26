import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pagePath = path.resolve(process.cwd(), "app/dashboard/create-pact/page.tsx");
const page = fs.readFileSync(pagePath, "utf8");

test("HOL-144: Step 4 success state is rendered only after create success", () => {
  // Invariant: wizard lands on Step 4 only when submission succeeds and sets pactResult.
  assert.match(page, /setPactResult\(/);
  assert.match(page, /setStep\(4\)/);
  assert.match(page, /\{step === 4 && pactResult && \(/);
});

test("HOL-144: success state includes pact ID and amount/mode details", () => {
  // Invariant: Step 4 includes pact ID and amount/mode messaging for created pact.
  assert.match(page, /Pact ID/);
  assert.match(page, /pactResult\.amount/);
  assert.match(page, /pactResult\.mode/);
  assert.match(page, /pactResult\.txSig/);
});

test("HOL-144: counterparty detail is rendered in Step 4", () => {
  // Fix: acceptance criterion requires counterparty display in success state.
  assert.ok(
    page.includes("pactResult.counterparty"),
    "counterparty must be displayed in success state",
  );
});

test("HOL-144: success state persists across refresh via sessionStorage", () => {
  // Fix: pact result is saved to sessionStorage and restored on mount.
  assert.ok(
    page.includes("sessionStorage"),
    "success state must be persisted to sessionStorage",
  );
  assert.match(page, /sessionStorage\.setItem/);
  assert.match(page, /sessionStorage\.getItem/);
});
