const {
  AutopoolUserCredit,
  AutopoolUpgradeCreditLedger,
  AutopoolParticipation,
} = require('../models');
const { isPoolReleased } = require('./release.rules');

async function getOrCreateCredit(userId, session) {
  let doc = await AutopoolUserCredit.findOne({ userId }).session(session || null);
  if (!doc) {
    const created = await AutopoolUserCredit.create(
      [{ userId, balance: 0 }],
      session ? { session } : undefined
    );
    doc = created[0];
  }
  return doc;
}

async function getBalance(userId, session) {
  const doc = await getOrCreateCredit(userId, session);
  return doc.balance || 0;
}

async function addCredit({ userId, amount = 1, idempotencyKey, referralEventId, reason, session }) {
  const existing = await AutopoolUpgradeCreditLedger.findOne({ idempotencyKey }).session(
    session || null
  );
  if (existing) {
    return { alreadyProcessed: true, balance: existing.balanceAfter };
  }

  const credit = await getOrCreateCredit(userId, session);
  credit.balance = (credit.balance || 0) + amount;
  await credit.save({ session });

  await AutopoolUpgradeCreditLedger.create(
    [
      {
        userId,
        type: 'earn',
        amount,
        balanceAfter: credit.balance,
        idempotencyKey,
        referralEventId: referralEventId || null,
        reason: reason || 'referral_event',
      },
    ],
    { session }
  );

  return { alreadyProcessed: false, balance: credit.balance };
}

async function consumeCredit({ userId, amount = 1, idempotencyKey, joinIdempotencyKey, reason, session }) {
  const existing = await AutopoolUpgradeCreditLedger.findOne({ idempotencyKey }).session(
    session || null
  );
  if (existing) {
    return { alreadyProcessed: true, balance: existing.balanceAfter };
  }

  const credit = await getOrCreateCredit(userId, session);
  if ((credit.balance || 0) < amount) {
    const err = new Error('Insufficient upgrade credits');
    err.code = 'NO_UPGRADE_CREDIT';
    throw err;
  }

  credit.balance -= amount;
  await credit.save({ session });

  await AutopoolUpgradeCreditLedger.create(
    [
      {
        userId,
        type: 'spend',
        amount,
        balanceAfter: credit.balance,
        idempotencyKey,
        joinIdempotencyKey: joinIdempotencyKey || null,
        reason: reason || 'join_next_pool',
      },
    ],
    { session }
  );

  return { alreadyProcessed: false, balance: credit.balance };
}

/**
 * After Pool 10 15/15: reset credits to 0 if no other occupying pools.
 */
async function maybeResetCreditsAfterPool10({ userId, pool10ParticipationId, session }) {
  const idempotencyKey = `credit-reset:pool10:${pool10ParticipationId}`;
  const existing = await AutopoolUpgradeCreditLedger.findOne({ idempotencyKey }).session(
    session || null
  );
  if (existing) {
    return { alreadyProcessed: true, reset: existing.amount > 0 || existing.reason === 'pool10_reset' };
  }

  const others = await AutopoolParticipation.find({
    userId,
    releasedAt: null,
    _id: { $ne: pool10ParticipationId },
  }).session(session || null);

  const stillOccupying = others.some((p) => !isPoolReleased(p));
  if (stillOccupying) {
    await AutopoolUpgradeCreditLedger.create(
      [
        {
          userId,
          type: 'reset',
          amount: 0,
          balanceAfter: (await getBalance(userId, session)),
          idempotencyKey,
          reason: 'pool10_complete_other_occupying_no_reset',
        },
      ],
      { session }
    );
    return { reset: false, reason: 'other_occupying' };
  }

  const credit = await getOrCreateCredit(userId, session);
  const prev = credit.balance || 0;
  credit.balance = 0;
  await credit.save({ session });

  await AutopoolUpgradeCreditLedger.create(
    [
      {
        userId,
        type: 'reset',
        amount: prev,
        balanceAfter: 0,
        idempotencyKey,
        reason: 'pool10_reset',
      },
    ],
    { session }
  );

  return { reset: true, previousBalance: prev };
}

module.exports = {
  getOrCreateCredit,
  getBalance,
  addCredit,
  consumeCredit,
  maybeResetCreditsAfterPool10,
};
