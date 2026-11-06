use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;

declare_id!("X402pAYwa1111111111111111111111111111111111");

#[program]
pub mod solana_x402 {
    use super::*;

    /// Initialize a merchant receiver account with custom pricing policies.
    pub fn initialize_merchant(
        ctx: Context<InitializeMerchant>,
        base_rate_lamports: u64,
        merchant_name: String,
    ) -> Result<()> {
        require!(merchant_name.len() <= 32, X402Error::MerchantNameTooLong);
        require!(base_rate_lamports > 0, X402Error::InvalidBaseRate);

        let merchant_account = &mut ctx.accounts.merchant_profile;
        merchant_account.authority = ctx.accounts.authority.key();
        merchant_account.settlement_vault = ctx.accounts.settlement_vault.key();
        merchant_account.base_rate_lamports = base_rate_lamports;
        merchant_account.total_settled_lamports = 0;
        merchant_account.total_transactions_count = 0;
        merchant_account.merchant_name = merchant_name;
        merchant_account.is_paused = false;
        merchant_account.bump = ctx.bumps.merchant_profile;

        emit!(MerchantRegisteredEvent {
            merchant: merchant_account.key(),
            authority: merchant_account.authority,
            settlement_vault: merchant_account.settlement_vault,
            base_rate_lamports,
        });

        Ok(())
    }

    /// Settle an x402 payment challenge natively on-chain.
    /// Locks a one-time Nonce PDA to guarantee non-replayability.
    pub fn settle_x402_payment(
        ctx: Context<SettleX402Payment>,
        payment_nonce: [u8; 32],
        resource_id: [u8; 16],
        lamports_amount: u64,
    ) -> Result<()> {
        let merchant = &mut ctx.accounts.merchant_profile;
        require!(!merchant.is_paused, X402Error::MerchantSuspended);
        require!(
            lamports_amount >= merchant.base_rate_lamports,
            X402Error::InsufficientPaymentAmount
        );

        // Record the payment nonce state to prevent replay attacks
        let session_receipt = &mut ctx.accounts.payment_receipt;
        session_receipt.payer = ctx.accounts.payer.key();
        session_receipt.merchant = merchant.key();
        session_receipt.payment_nonce = payment_nonce;
        session_receipt.resource_id = resource_id;
        session_receipt.amount_paid = lamports_amount;
        session_receipt.timestamp = Clock::get()?.unix_timestamp;
        session_receipt.bump = ctx.bumps.payment_receipt;

        // Perform native SOL transfer from Payer to Merchant Settlement Vault
        let transfer_instruction = system_instruction::transfer(
            &ctx.accounts.payer.key(),
            &ctx.accounts.settlement_vault.key(),
            lamports_amount,
        );

        anchor_lang::solana_program::program::invoke(
            &transfer_instruction,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.settlement_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Update merchant accounting
        merchant.total_settled_lamports = merchant
            .total_settled_lamports
            .checked_add(lamports_amount)
            .ok_or(X402Error::NumericalOverflow)?;
        merchant.total_transactions_count = merchant
            .total_transactions_count
            .checked_add(1)
            .ok_or(X402Error::NumericalOverflow)?;

        emit!(X402PaymentSettledEvent {
            receipt: session_receipt.key(),
            payer: ctx.accounts.payer.key(),
            merchant: merchant.key(),
            resource_id,
            payment_nonce,
            amount_lamports: lamports_amount,
            settled_at: session_receipt.timestamp,
        });

        Ok(())
    }

    /// Pause or resume payment operations
    pub fn set_merchant_pause_status(
        ctx: Context<UpdateMerchantConfig>,
        is_paused: bool,
    ) -> Result<()> {
        let merchant = &mut ctx.accounts.merchant_profile;
        merchant.is_paused = is_paused;
        Ok(())
    }

    /// Update base pricing threshold
    pub fn update_base_rate(
        ctx: Context<UpdateMerchantConfig>,
        new_base_rate_lamports: u64,
    ) -> Result<()> {
        require!(new_base_rate_lamports > 0, X402Error::InvalidBaseRate);
        let merchant = &mut ctx.accounts.merchant_profile;
        merchant.base_rate_lamports = new_base_rate_lamports;
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT STRUCTURES & INSTRUCTION CONTEXTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(base_rate_lamports: u64, merchant_name: String)]
pub struct InitializeMerchant<'info> {
    #[account(
        init,
        payer = authority,
        space = MerchantProfile::LEN,
        seeds = [b"merchant", authority.key().as_ref()],
        bump
    )]
    pub merchant_profile: Account<'info, MerchantProfile>,

    /// CHECK: Safe settlement wallet designated by merchant authority
    pub settlement_vault: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(payment_nonce: [u8; 32], resource_id: [u8; 16], lamports_amount: u64)]
pub struct SettleX402Payment<'info> {
    #[account(
        init,
        payer = payer,
        space = PaymentReceipt::LEN,
        seeds = [b"x402_receipt", merchant_profile.key().as_ref(), payment_nonce.as_ref()],
        bump
    )]
    pub payment_receipt: Account<'info, PaymentReceipt>,

    #[account(
        mut,
        seeds = [b"merchant", merchant_profile.authority.as_ref()],
        bump = merchant_profile.bump,
        has_one = settlement_vault @ X402Error::InvalidSettlementVault
    )]
    pub merchant_profile: Account<'info, MerchantProfile>,

    /// CHECK: Checked against merchant_profile.settlement_vault
    #[account(mut)]
    pub settlement_vault: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMerchantConfig<'info> {
    #[account(
        mut,
        seeds = [b"merchant", authority.key().as_ref()],
        bump = merchant_profile.bump,
        has_one = authority @ X402Error::UnauthorizedAuthority
    )]
    pub merchant_profile: Account<'info, MerchantProfile>,

    pub authority: Signer<'info>,
}

// -----------------------------------------------------------------------------
// DATA STATES
// -----------------------------------------------------------------------------

#[account]
pub struct MerchantProfile {
    pub authority: Pubkey,              // 32
    pub settlement_vault: Pubkey,       // 32
    pub base_rate_lamports: u64,        // 8
    pub total_settled_lamports: u64,    // 8
    pub total_transactions_count: u64,  // 8
    pub is_paused: bool,                // 1
    pub bump: u8,                       // 1
    pub merchant_name: String,          // 4 + 32
}

impl MerchantProfile {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 1 + (4 + 32);
}

#[account]
pub struct PaymentReceipt {
    pub payer: Pubkey,                  // 32
    pub merchant: Pubkey,               // 32
    pub payment_nonce: [u8; 32],        // 32
    pub resource_id: [u8; 16],          // 16
    pub amount_paid: u64,               // 8
    pub timestamp: i64,                 // 8
    pub bump: u8,                       // 1
}

impl PaymentReceipt {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 16 + 8 + 8 + 1;
}

// -----------------------------------------------------------------------------
// EVENTS & ERRORS
// -----------------------------------------------------------------------------

#[event]
pub struct MerchantRegisteredEvent {
    pub merchant: Pubkey,
    pub authority: Pubkey,
    pub settlement_vault: Pubkey,
    pub base_rate_lamports: u64,
}

#[event]
pub struct X402PaymentSettledEvent {
    pub receipt: Pubkey,
    pub payer: Pubkey,
    pub merchant: Pubkey,
    pub resource_id: [u8; 16],
    pub payment_nonce: [u8; 32],
    pub amount_lamports: u64,
    pub settled_at: i64,
}

#[error_code]
pub enum X402Error {
    #[msg("Provided merchant display name exceeds 32 bytes.")]
    MerchantNameTooLong,
    #[msg("Base rate lamports must be strictly greater than zero.")]
    InvalidBaseRate,
    #[msg("Merchant operations are temporarily suspended.")]
    MerchantSuspended,
    #[msg("Supplied payment is strictly lower than merchant base rate.")]
    InsufficientPaymentAmount,
    #[msg("Target settlement vault does not match registered merchant profile.")]
    InvalidSettlementVault,
    #[msg("Caller is unauthorized to modify merchant configuration.")]
    UnauthorizedAuthority,
    #[msg("Numerical overflow encountered in arithmetic accumulator.")]
    NumericalOverflow,
}