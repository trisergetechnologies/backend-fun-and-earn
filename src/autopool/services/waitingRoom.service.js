const { AutopoolWaitingRoom, AutopoolNextPoolEligibility } = require('../models');

/**
 * Idempotently enqueue a WAITING seat for an AVAILABLE eligibility.
 */
async function enqueueFromEligibility(eligibility, session) {
  if (!eligibility || eligibility.status !== 'AVAILABLE') {
    return { enqueued: false, reason: 'not_available' };
  }

  const existing = await AutopoolWaitingRoom.findOne({
    sourceParticipationId: eligibility.sourceParticipationId,
    status: 'WAITING',
  }).session(session || null);

  if (existing) {
    return { enqueued: false, already: true, seat: existing };
  }

  try {
    const [seat] = await AutopoolWaitingRoom.create(
      [
        {
          userId: eligibility.userId,
          targetPoolLevel: eligibility.targetPoolLevel,
          sourceParticipationId: eligibility.sourceParticipationId,
          eligibilityId: eligibility._id,
          entryAmount: eligibility.entryAmount,
          status: 'WAITING',
          enqueuedAt: eligibility.earnedAt || new Date(),
        },
      ],
      session ? { session } : undefined
    );
    return { enqueued: true, seat };
  } catch (err) {
    // Unique partial index race → treat as already queued
    if (err?.code === 11000) {
      const seat = await AutopoolWaitingRoom.findOne({
        sourceParticipationId: eligibility.sourceParticipationId,
        status: 'WAITING',
      }).session(session || null);
      return { enqueued: false, already: true, seat };
    }
    throw err;
  }
}

async function enqueueForSourceParticipation(sourceParticipationId, session) {
  const eligibility = await AutopoolNextPoolEligibility.findOne({
    sourceParticipationId,
    status: 'AVAILABLE',
  }).session(session || null);
  if (!eligibility) return { enqueued: false, reason: 'no_eligibility' };
  return enqueueFromEligibility(eligibility, session);
}

async function userHasWaitingSeat(userId, targetPoolLevel, session) {
  const count = await AutopoolWaitingRoom.countDocuments({
    userId,
    targetPoolLevel,
    status: 'WAITING',
  }).session(session || null);
  return count > 0;
}

async function getWaitingSeatsForUser(userId, session) {
  return AutopoolWaitingRoom.find({
    userId,
    status: 'WAITING',
  })
    .sort({ enqueuedAt: 1 })
    .session(session || null)
    .lean();
}

/**
 * Position in FIFO for a given WAITING seat (1-based), among all WAITING for that pool.
 */
async function getQueuePosition(seat, session) {
  if (!seat || seat.status !== 'WAITING') return null;
  const ahead = await AutopoolWaitingRoom.countDocuments({
    targetPoolLevel: seat.targetPoolLevel,
    status: 'WAITING',
    enqueuedAt: { $lt: seat.enqueuedAt },
  }).session(session || null);
  return ahead + 1;
}

async function markSeatJoined(seatId, joinedParticipationId, session) {
  return AutopoolWaitingRoom.findOneAndUpdate(
    { _id: seatId, status: 'WAITING' },
    {
      $set: {
        status: 'JOINED',
        joinedAt: new Date(),
        joinedParticipationId,
      },
    },
    { new: true, session: session || null }
  );
}

module.exports = {
  enqueueFromEligibility,
  enqueueForSourceParticipation,
  userHasWaitingSeat,
  getWaitingSeatsForUser,
  getQueuePosition,
  markSeatJoined,
};
