import { assert } from "chai";
import * as fs from "fs";
import * as path from "path";

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

describe("HOL-131 code-level coverage review", () => {
  it("MED-F-001 invariant: dispute state commits payout token accounts and resolve_dispute enforces them", () => {
    // Invariant validated: raise_dispute commits payout destinations and
    // resolve_dispute enforces those commitments via has_one constraints.
    const disputeState = read("programs/vaultpact-escrow/src/state/dispute_record.rs");
    const raiseDispute = read("programs/vaultpact-escrow/src/instructions/raise_dispute.rs");
    const resolveDispute = read("programs/vaultpact-escrow/src/instructions/resolve_dispute.rs");

    assert.include(
      disputeState,
      "beneficiary_token_account",
      "DisputeRecord should commit beneficiary token account",
    );
    assert.include(
      disputeState,
      "initiator_token_account",
      "DisputeRecord should commit initiator token account",
    );
    assert.include(
      raiseDispute,
      "dispute.beneficiary_token_account = ctx.accounts.beneficiary_token_account.key();",
      "raise_dispute should store committed beneficiary token account",
    );
    assert.include(
      raiseDispute,
      "dispute.initiator_token_account = ctx.accounts.initiator_token_account.key();",
      "raise_dispute should store committed initiator token account",
    );
    assert.include(
      resolveDispute,
      "has_one = beneficiary_token_account @ EscrowError::UnauthorizedTokenAccount",
      "resolve_dispute should enforce committed beneficiary token account",
    );
    assert.include(
      resolveDispute,
      "has_one = initiator_token_account @ EscrowError::UnauthorizedTokenAccount",
      "resolve_dispute should enforce committed initiator token account",
    );
  });

  it("MED-F-002 invariant: cancel_pending_escrow calls cpi_update_reputation for both parties", () => {
    // Invariant validated: pending cancel path now performs reputation CPI updates.
    const cancelPending = read("programs/vaultpact-escrow/src/instructions/cancel_pending_escrow.rs");
    assert.include(
      cancelPending,
      "cpi_update_reputation(",
      "cancel_pending_escrow should include reputation CPI calls",
    );
    assert.include(cancelPending, "initiator_reputation", "initiator reputation account should be required");
    assert.include(cancelPending, "beneficiary_reputation", "beneficiary reputation account should be required");
    assert.include(cancelPending, "escrow_authority", "escrow authority signer should be required");
  });

  it("LOW-F-004 invariant: selected non-transfer instructions enforce has_one = vault", () => {
    // Invariant validated: defense-in-depth vault linkage is present.
    const raiseDispute = read("programs/vaultpact-escrow/src/instructions/raise_dispute.rs");
    const releaseEscrow = read("programs/vaultpact-escrow/src/instructions/release_escrow.rs");
    const escalateDispute = read("programs/vaultpact-escrow/src/instructions/escalate_dispute.rs");

    assert.include(raiseDispute, "has_one = vault", "raise_dispute should enforce has_one=vault");
    assert.include(releaseEscrow, "has_one = vault", "release_escrow should enforce has_one=vault");
    assert.include(escalateDispute, "has_one = vault", "escalate_dispute should enforce has_one=vault");
  });
});
