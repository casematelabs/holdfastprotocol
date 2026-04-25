use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Escrow amount must be greater than zero")]
    ZeroEscrowAmount,
    #[msg("Initiator, beneficiary, and arbiter must all be distinct")]
    DuplicateParticipants,
    #[msg("Time lock expiry must be in the future")]
    TimeLockInPast,
    #[msg("Mint is owned by Token-2022 program; only classic SPL Token is supported in v0.1")]
    UnsupportedMintVersion,
    #[msg("Invalid escrow status for this operation")]
    InvalidStatus,
    #[msg("Unauthorized signer for this operation")]
    UnauthorizedSigner,
    #[msg("Vault balance does not match expected total")]
    VaultBalanceMismatch,
    #[msg("Time lock has not yet expired")]
    TimeLockNotExpired,
    #[msg("Dispute window has not ended")]
    DisputeWindowOpen,
    #[msg("Dispute window has ended")]
    DisputeWindowClosed,
    #[msg("Signer must be initiator or beneficiary")]
    NotParticipant,
    #[msg("Arithmetic overflow in payout calculation")]
    ArithmeticOverflow,
    #[msg("SplitFunds beneficiary_bps must be <= 10000")]
    InvalidBasisPoints,
    #[msg("Vault must be empty before closing escrow")]
    VaultNotEmpty,
    #[msg("Dispute resolution deadline has not passed")]
    ResolutionDeadlineNotPassed,
    #[msg("Arbiter decision must not be None when resolving")]
    DecisionRequired,
    // Agent wallet status checks (CAS-36 coordination)
    #[msg("Agent wallet status is not Active; new pact commitments require Active status")]
    AgentNotActive,
    #[msg("Agent is blacklisted; settlement and claims are blocked")]
    AgentBlacklisted,
    #[msg("Agent wallet authority does not match the expected escrow party")]
    AgentWalletAuthorityMismatch,
    #[msg("Blacklisted wallet is not actually blacklisted (status != 2)")]
    AgentNotBlacklisted,
    #[msg("Blacklisted wallet does not belong to either escrow party")]
    WalletNotPactParty,
    #[msg("Caller is not the protocol authority from AttestationRegistry")]
    UnauthorizedProtocolAuthority,
    #[msg("Token account owner does not match the expected escrow party")]
    UnauthorizedTokenAccount,
    #[msg("Beneficiary has already staked; cannot stake twice")]
    BeneficiaryAlreadyStaked,
    #[msg("Invalid verification tier value (must be 0, 1, or 2)")]
    InvalidVerifTier,
    #[msg("dispute_deadline_secs must be >= 3600 (minimum 1-hour arbiter window)")]
    InvalidDisputeDeadline,
    #[msg("Dispute has already been escalated; escalation is a one-shot operation")]
    DisputeAlreadyEscalated,
    #[msg("Dispute has not been escalated; call escalate_dispute first")]
    DisputeNotEscalated,
    #[msg("Escalation grace period has not passed; fallback refund not yet available")]
    EscalationGracePeriodNotPassed,
    #[msg("PactRecord does not belong to this EscrowAccount")]
    PactEscrowMismatch,
    #[msg("Reputation account does not belong to the expected escrow party")]
    ReputationAccountMismatch,
    #[msg("Stake amount is below the protocol minimum (1000 base units)")]
    StakeBelowMinimum,
    #[msg("slash_loser_stake requires both initiator_stake and beneficiary_stake to be non-zero")]
    SlashRequiresStake,
    #[msg("A dispute is in progress; mutual cancellation is not allowed")]
    DisputeInProgress,
    #[msg("One or more signers are blacklisted; mutual cancellation is blocked")]
    BlacklistedSigner,
}
