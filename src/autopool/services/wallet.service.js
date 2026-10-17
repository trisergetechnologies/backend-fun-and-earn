const User = require('../../models/User');
const WalletTransaction = require('../../models/WalletTransaction');
const { AutopoolLedger } = require('../models');

const COUPON_CREDIT_REQUIRED_MSG =
  'Buy products on Dream Mart to earn coupon credit, then redeem it to join the Loyalty Pool.';

/**
 * Debit eCartWallet for Autopool (additive WalletTransaction source=autopool).
 * Pool 1 entry must come from eCartCouponCredit (coupon-redeemed Dream Mart balance).
 */
async function debitEcartForAutopool({
  userId,
  amount,
  notes,
  idempotencyKey,
  session,
  participationId,
  poolLevel,
}) {
  const existing = await AutopoolLedger.findOne({ idempotencyKey }).session(session);
  if (existing) {
    return { alreadyProcessed: true, ledger: existing };
  }

  const user = await User.findById(userId)
    .select('wallets.eCartWallet wallets.eCartCouponCredit')
    .session(session);
  if (!user) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  const walletBal = Number(user.wallets?.eCartWallet) || 0;
  const couponCredit = Number(user.wallets?.eCartCouponCredit) || 0;

  if (couponCredit < amount) {
    const err = new Error(COUPON_CREDIT_REQUIRED_MSG);
    err.code = 'INSUFFICIENT_COUPON_CREDIT';
    throw err;
  }

  if (walletBal < amount) {
    const err = new Error('Insufficient DreamMart Points');
    err.code = 'INSUFFICIENT_WALLET';
    throw err;
  }

  const updated = await User.findOneAndUpdate(
    {
      _id: userId,
      'wallets.eCartWallet': { $gte: amount },
      'wallets.eCartCouponCredit': { $gte: amount },
    },
    {
      $inc: {
        'wallets.eCartWallet': -amount,
        'wallets.eCartCouponCredit': -amount,
      },
    },
    { new: true, session }
  );

  if (!updated) {
    // Race: re-check which gate failed
    const fresh = await User.findById(userId)
      .select('wallets.eCartWallet wallets.eCartCouponCredit')
      .session(session);
    const credit = Number(fresh?.wallets?.eCartCouponCredit) || 0;
    if (credit < amount) {
      const err = new Error(COUPON_CREDIT_REQUIRED_MSG);
      err.code = 'INSUFFICIENT_COUPON_CREDIT';
      throw err;
    }
    const err = new Error('Insufficient DreamMart Points');
    err.code = 'INSUFFICIENT_WALLET';
    throw err;
  }

  await WalletTransaction.create(
    [
      {
        userId,
        type: 'spend',
        source: 'autopool',
        fromWallet: 'eCartWallet',
        toWallet: null,
        amount,
        status: 'success',
        triggeredBy: 'user',
        notes: notes || `Autopool debit ${idempotencyKey}`,
      },
    ],
    { session }
  );

  const ledgerDocs = await AutopoolLedger.create(
    [
      {
        idempotencyKey,
        type: 'manual_entry_debit',
        amount,
        userId,
        poolLevel,
        participationId: participationId || null,
        allocationType: 'manual_entry',
      },
    ],
    { session }
  );

  return {
    alreadyProcessed: false,
    user: updated,
    ledger: ledgerDocs[0],
    newBalance: updated.wallets.eCartWallet,
  };
}

/**
 * Credit eCartWallet for Autopool cycle reward.
 * Does not increase eCartCouponCredit (rewards are not coupon credit).
 */
async function creditEcartForAutopool({
  userId,
  amount,
  notes,
  idempotencyKey,
  session,
  participationId,
  cycleId,
  poolLevel,
}) {
  if (amount <= 0) return { skipped: true };

  const existing = await AutopoolLedger.findOne({ idempotencyKey }).session(session);
  if (existing) {
    return { alreadyProcessed: true, ledger: existing };
  }

  const updated = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { 'wallets.eCartWallet': amount } },
    { new: true, session }
  );

  await WalletTransaction.create(
    [
      {
        userId,
        type: 'earn',
        source: 'autopool',
        fromWallet: 'eCartWallet',
        toWallet: 'eCartWallet',
        amount,
        status: 'success',
        triggeredBy: 'system',
        notes: notes || `Autopool reward ${idempotencyKey}`,
      },
    ],
    { session }
  );

  const ledgerDocs = await AutopoolLedger.create(
    [
      {
        idempotencyKey,
        type: 'wallet_reward',
        amount,
        userId,
        poolLevel,
        participationId,
        cycleId,
        allocationType: 'wallet',
      },
    ],
    { session }
  );

  return { alreadyProcessed: false, user: updated, ledger: ledgerDocs[0] };
}

module.exports = {
  debitEcartForAutopool,
  creditEcartForAutopool,
  COUPON_CREDIT_REQUIRED_MSG,
};
