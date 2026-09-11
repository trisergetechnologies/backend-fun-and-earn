const User = require('../../models/User');
const WalletTransaction = require('../../models/WalletTransaction');
const { AutopoolLedger } = require('../models');

/**
 * Debit eCartWallet for Autopool (additive WalletTransaction source=autopool).
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

  const updated = await User.findOneAndUpdate(
    { _id: userId, 'wallets.eCartWallet': { $gte: amount } },
    { $inc: { 'wallets.eCartWallet': -amount } },
    { new: true, session }
  );

  if (!updated) {
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
};
