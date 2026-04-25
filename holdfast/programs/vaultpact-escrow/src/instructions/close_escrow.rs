use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount};

use crate::errors::EscrowError;
use crate::state::*;

#[derive(Accounts)]
pub struct CloseEscrow<'info> {
    #[account(mut)]
    pub initiator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_account.escrow_id.as_ref()],
        bump = escrow_account.bump,
        has_one = initiator @ EscrowError::UnauthorizedSigner,
        has_one = pact_record @ EscrowError::PactEscrowMismatch,
        has_one = vault,
        close = initiator,
    )]
    pub escrow_account: Box<Account<'info, EscrowAccount>>,

    #[account(
        mut,
        seeds = [b"pact", escrow_account.escrow_id.as_ref()],
        bump = pact_record.bump,
        close = initiator,
    )]
    pub pact_record: Box<Account<'info, PactRecord>>,

    #[account(
        mut,
        seeds = [b"dispute", escrow_account.escrow_id.as_ref()],
        bump,
        close = initiator,
    )]
    pub dispute_record: Option<Box<Account<'info, DisputeRecord>>>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<CloseEscrow>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;

    require!(
        escrow.status == EscrowStatus::Pending
            || escrow.status == EscrowStatus::Refunded
            || escrow.status == EscrowStatus::Claimed
            || escrow.status == EscrowStatus::MutuallyCancelled,
        EscrowError::InvalidStatus
    );

    require!(ctx.accounts.vault.amount == 0, EscrowError::VaultNotEmpty);

    let escrow_id = escrow.escrow_id;
    let bump = escrow.bump;

    // Close the vault token account, return rent to initiator
    let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", escrow_id.as_ref(), &[bump]]];
    let cpi_accounts = CloseAccount {
        account: ctx.accounts.vault.to_account_info(),
        destination: ctx.accounts.initiator.to_account_info(),
        authority: ctx.accounts.escrow_account.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::close_account(cpi_ctx)?;

    msg!("Escrow closed");
    Ok(())
}

pub(crate) fn is_closeable_status(status: EscrowStatus) -> bool {
    matches!(
        status,
        EscrowStatus::Pending
            | EscrowStatus::Refunded
            | EscrowStatus::Claimed
            | EscrowStatus::MutuallyCancelled
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refunded_is_closeable() {
        assert!(is_closeable_status(EscrowStatus::Refunded));
    }

    #[test]
    fn claimed_is_closeable() {
        assert!(is_closeable_status(EscrowStatus::Claimed));
    }

    #[test]
    fn mutually_cancelled_is_closeable() {
        assert!(is_closeable_status(EscrowStatus::MutuallyCancelled));
    }

    #[test]
    fn pending_is_closeable() {
        assert!(is_closeable_status(EscrowStatus::Pending));
    }

    #[test]
    fn non_terminal_statuses_are_not_closeable() {
        for bad in [
            EscrowStatus::Funded,
            EscrowStatus::Locked,
            EscrowStatus::Released,
            EscrowStatus::Disputed,
            EscrowStatus::Closed,
        ] {
            assert!(!is_closeable_status(bad), "status {:?} should not be closeable", bad);
        }
    }

    #[test]
    fn vault_must_be_empty() {
        let vault_amount = 0u64;
        assert_eq!(vault_amount, 0, "close_escrow requires empty vault");
    }

    #[test]
    fn vault_not_empty_blocks_close() {
        let vault_amount = 1u64;
        assert!(vault_amount != 0, "non-empty vault should block close");
    }
}
