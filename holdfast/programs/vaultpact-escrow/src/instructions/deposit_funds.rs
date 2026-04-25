use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::EscrowError;
use crate::state::*;

#[derive(Accounts)]
pub struct DepositFunds<'info> {
    pub initiator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_account.escrow_id.as_ref()],
        bump = escrow_account.bump,
        has_one = initiator @ EscrowError::UnauthorizedSigner,
        has_one = vault,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    #[account(
        mut,
        constraint = initiator_token_account.owner == initiator.key()
            @ EscrowError::UnauthorizedTokenAccount,
        constraint = initiator_token_account.mint == escrow_account.mint
            @ EscrowError::UnauthorizedTokenAccount,
    )]
    pub initiator_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub(crate) fn compute_deposit_amount(
    escrow_amount: u64,
    initiator_stake: u64,
) -> anchor_lang::Result<u64> {
    escrow_amount
        .checked_add(initiator_stake)
        .ok_or_else(|| anchor_lang::error!(EscrowError::ArithmeticOverflow))
}

pub fn handler(ctx: Context<DepositFunds>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_account;

    require!(escrow.status == EscrowStatus::Pending, EscrowError::InvalidStatus);

    let deposit_amount = compute_deposit_amount(escrow.escrow_amount, escrow.initiator_stake)?;

    // CEI: set status BEFORE token transfer
    escrow.status = EscrowStatus::Funded;

    // Interaction: transfer tokens
    let cpi_accounts = Transfer {
        from: ctx.accounts.initiator_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.initiator.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    token::transfer(cpi_ctx, deposit_amount)?;

    msg!("Funds deposited: {}", deposit_amount);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::errors::EscrowError;

    fn err_code(err: anchor_lang::error::Error) -> u32 {
        match err {
            anchor_lang::error::Error::AnchorError(ae) => ae.error_code_number,
            _ => panic!("expected AnchorError"),
        }
    }

    #[test]
    fn deposit_escrow_only() {
        assert_eq!(compute_deposit_amount(5_000, 0).unwrap(), 5_000);
    }

    #[test]
    fn deposit_with_initiator_stake() {
        assert_eq!(compute_deposit_amount(1_000, 200).unwrap(), 1_200);
    }

    #[test]
    fn deposit_overflow_guard() {
        let err = compute_deposit_amount(u64::MAX, 1).unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn deposit_max_no_overflow() {
        assert_eq!(compute_deposit_amount(u64::MAX - 100, 100).unwrap(), u64::MAX);
    }

    #[test]
    fn deposit_requires_pending_status() {
        assert_eq!(EscrowStatus::Pending, EscrowStatus::Pending);
        for bad in [
            EscrowStatus::Funded,
            EscrowStatus::Locked,
            EscrowStatus::Released,
            EscrowStatus::Disputed,
            EscrowStatus::Refunded,
            EscrowStatus::Claimed,
            EscrowStatus::Closed,
            EscrowStatus::MutuallyCancelled,
        ] {
            assert!(bad != EscrowStatus::Pending, "status {:?} should not allow deposit", bad);
        }
    }
}
