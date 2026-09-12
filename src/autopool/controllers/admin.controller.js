const User = require('../../models/User');
const {
  AutopoolSettings,
  AutopoolPoolConfig,
  AutopoolParticipation,
  AutopoolPlacement,
  AutopoolCycle,
  AutopoolLedger,
  AutopoolReferralEvent,
  AutopoolUpgradeCreditLedger,
  AutopoolUserCredit,
  AutopoolSystemBalances,
  AutopoolNextPoolEligibility,
} = require('../models');
const {
  ensureSettings,
  seedPoolConfigs,
  ensureSystemBalances,
  isAutopoolEnabled,
  enabledSourceLabel,
} = require('../services/config.service');
const { bootstrapRootUser } = require('../services/entry.service');

function mapError(err, res) {
  console.error('[autopool admin]', err);
  return res.status(err.code === 'USER_NOT_FOUND' ? 404 : 500).json({
    success: false,
    code: err.code || 'AUTOPOOL_ERROR',
    message: err.message || 'Autopool admin error',
  });
}

exports.getHealth = async (req, res) => {
  try {
    await seedPoolConfigs();
    const settings = await ensureSettings();
    const balances = await ensureSystemBalances();
    const poolCount = await AutopoolPoolConfig.countDocuments();
    const occupying = await AutopoolParticipation.countDocuments({ releasedAt: null });
    const enabled = await isAutopoolEnabled();
    return res.json({
      success: true,
      data: {
        enabled,
        enabledSource: enabledSourceLabel(),
        bootstrapUserId: settings.bootstrapUserId,
        poolCount,
        occupyingParticipations: occupying,
        featureReserve: balances.featureReserve,
        adminAllocation: balances.adminAllocation,
      },
    });
  } catch (err) {
    return mapError(err, res);
  }
};

/** Enablement is env-only (AUTOPOOL_ENABLED). Kept for older clients. */
exports.setEnabled = async (req, res) => {
  return res.status(400).json({
    success: false,
    code: 'ENV_ONLY',
    message:
      'Autopool on/off is controlled by backend env AUTOPOOL_ENABLED=true|false. Admin toggle is disabled.',
    data: {
      enabled: await isAutopoolEnabled(),
      enabledSource: enabledSourceLabel(),
    },
  });
};

exports.getConfigs = async (req, res) => {
  try {
    await seedPoolConfigs();
    const configs = await AutopoolPoolConfig.find({}).sort({ poolLevel: 1 });
    return res.json({ success: true, data: configs });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.updateConfig = async (req, res) => {
  try {
    const level = Number(req.params.level);
    const config = await AutopoolPoolConfig.findOne({ poolLevel: level });
    if (!config) {
      return res.status(404).json({ success: false, message: 'Pool not found' });
    }
    const { entryAmount, active, maxCycles, distribution } = req.body || {};
    if (entryAmount !== undefined) config.entryAmount = Number(entryAmount);
    if (active !== undefined) config.active = Boolean(active);
    if (maxCycles !== undefined) config.maxCycles = Number(maxCycles);
    if (distribution && typeof distribution === 'object') {
      config.distribution = { ...config.distribution.toObject?.() || config.distribution, ...distribution };
    }
    config.configVersion = (config.configVersion || 1) + 1;
    await config.save();
    return res.json({ success: true, data: config });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.searchParticipations = async (req, res) => {
  try {
    const { userId, poolLevel, status, serialNumber, limit = 50 } = req.query;
    const filter = {};
    if (userId) filter.userId = userId;
    if (poolLevel) filter.poolLevel = Number(poolLevel);
    if (status) filter.status = status;
    if (serialNumber) {
      const u = await User.findOne({ serialNumber: Number(serialNumber) }).select('_id');
      if (!u) return res.json({ success: true, data: [] });
      filter.userId = u._id;
    }
    const rows = await AutopoolParticipation.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 50, 200))
      .populate('userId', 'name email serialNumber');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.getPlacementQueue = async (req, res) => {
  try {
    const poolLevel = req.query.poolLevel ? Number(req.query.poolLevel) : null;
    const filter = { openSlots: { $gt: 0 }, status: { $in: ['WAITING', 'PLACED'] } };
    if (poolLevel) filter.poolLevel = poolLevel;
    const rows = await AutopoolPlacement.find(filter)
      .sort({ poolLevel: 1, queueSequence: 1 })
      .limit(200)
      .populate('userId', 'name serialNumber');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.getLedgers = async (req, res) => {
  try {
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.userId) filter.userId = req.query.userId;
    const rows = await AutopoolLedger.find(filter)
      .sort({ createdAt: -1 })
      .limit(100);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.getCycles = async (req, res) => {
  try {
    const filter = {};
    if (req.query.participationId) filter.participationId = req.query.participationId;
    if (req.query.userId) filter.userId = req.query.userId;
    const rows = await AutopoolCycle.find(filter).sort({ createdAt: -1 }).limit(100);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.getBalances = async (req, res) => {
  try {
    const balances = await ensureSystemBalances();
    return res.json({ success: true, data: balances });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.getReferrals = async (req, res) => {
  try {
    const rows = await AutopoolReferralEvent.find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('referrerUserId', 'name serialNumber')
      .populate('referredUserId', 'name serialNumber');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.getCredits = async (req, res) => {
  try {
    const balances = await AutopoolUserCredit.find({})
      .sort({ balance: -1 })
      .limit(100)
      .populate('userId', 'name serialNumber');
    const ledger = await AutopoolUpgradeCreditLedger.find({})
      .sort({ createdAt: -1 })
      .limit(100);
    return res.json({ success: true, data: { balances, ledger } });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.getEligibilities = async (req, res) => {
  try {
    const rows = await AutopoolNextPoolEligibility.find({})
      .sort({ earnedAt: -1 })
      .limit(100);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return mapError(err, res);
  }
};

/**
 * Full pool matrix for admin visualization: all seats, FIFO open queue, recent cycles.
 * GET /autopool/admin/matrix?poolLevel=1
 */
exports.getMatrix = async (req, res) => {
  try {
    const poolLevel = Math.min(10, Math.max(1, Number(req.query.poolLevel) || 1));

    const [placements, participations, recentCycles, balances, occupying] =
      await Promise.all([
        AutopoolPlacement.find({ poolLevel })
          .sort({ queueSequence: 1 })
          .limit(2000)
          .lean(),
        AutopoolParticipation.find({ poolLevel, releasedAt: null })
          .select(
            '_id userId cycleCount status placementId nextPoolEligibleAmount entryType isBootstrap configSnapshot.maxCycles'
          )
          .lean(),
        AutopoolCycle.find({ poolLevel })
          .sort({ completedAt: -1 })
          .limit(30)
          .lean(),
        ensureSystemBalances(),
        AutopoolParticipation.countDocuments({ poolLevel, releasedAt: null }),
      ]);

    const userIds = new Set();
    placements.forEach((p) => {
      if (p.userId) userIds.add(String(p.userId));
    });
    participations.forEach((p) => {
      if (p.userId) userIds.add(String(p.userId));
    });
    recentCycles.forEach((c) => {
      if (c.userId) userIds.add(String(c.userId));
    });

    const users = await User.find({ _id: { $in: [...userIds] } })
      .select('name serialNumber')
      .lean();
    const userMap = {};
    users.forEach((u) => {
      userMap[String(u._id)] = {
        _id: u._id,
        name: u.name,
        serialNumber: u.serialNumber,
      };
    });

    const partMap = {};
    const currentPlacementIds = new Set();
    participations.forEach((p) => {
      partMap[String(p._id)] = p;
      if (p.placementId) currentPlacementIds.add(String(p.placementId));
    });

    const seats = placements.map((pl) => {
      const part = partMap[String(pl.participationId)];
      const parentPart = pl.parentParticipationId
        ? partMap[String(pl.parentParticipationId)]
        : null;
      const parentUser = parentPart
        ? userMap[String(parentPart.userId)]
        : pl.parentParticipationId
          ? null
          : null;
      // parent user from any placement of parent participation
      let parentUserResolved = parentUser;
      if (pl.parentParticipationId && !parentUserResolved) {
        const parentSeat = placements.find(
          (x) => String(x.participationId) === String(pl.parentParticipationId)
        );
        if (parentSeat) parentUserResolved = userMap[String(parentSeat.userId)] || null;
      }

      return {
        placementId: pl._id,
        queueSequence: pl.queueSequence,
        slot: pl.slot,
        status: pl.status,
        openSlots: pl.openSlots,
        generation: pl.generation ?? 0,
        leftChildParticipationId: pl.leftChildParticipationId,
        rightChildParticipationId: pl.rightChildParticipationId,
        participationId: pl.participationId,
        parentParticipationId: pl.parentParticipationId,
        userId: pl.userId,
        user: userMap[String(pl.userId)] || null,
        parentUser: parentUserResolved,
        cycleCount: part?.cycleCount ?? null,
        maxCycles: part?.configSnapshot?.maxCycles ?? 15,
        participationStatus: part?.status ?? null,
        isCurrentSeat: currentPlacementIds.has(String(pl._id)),
        filledAt: pl.filledAt,
      };
    });

    const fifoQueue = seats
      .filter(
        (s) =>
          (s.status === 'PLACED' || s.status === 'WAITING') && (s.openSlots || 0) > 0
      )
      .sort((a, b) => a.queueSequence - b.queueSequence)
      .map((s) => ({
        placementId: s.placementId,
        queueSequence: s.queueSequence,
        openSlots: s.openSlots,
        slot: s.slot,
        user: s.user,
        participationId: s.participationId,
        nextSlot: s.leftChildParticipationId ? 'right' : 'left',
      }));

    const nextFill = fifoQueue[0] || null;

    const cyclesOut = recentCycles.map((c) => ({
      _id: c._id,
      participationId: c.participationId,
      userId: c.userId,
      user: userMap[String(c.userId)] || null,
      poolLevel: c.poolLevel,
      cycleNumber: c.cycleNumber,
      collectionAmount: c.collectionAmount,
      samePoolAmount: c.samePoolAmount,
      walletAmount: c.walletAmount,
      nextPoolAmount: c.nextPoolAmount,
      adminAmount: c.adminAmount,
      featureAmount: c.featureAmount,
      completedAt: c.completedAt,
    }));

    const openSeatCount = fifoQueue.reduce((n, s) => n + (s.openSlots || 0), 0);

    return res.json({
      success: true,
      data: {
        poolLevel,
        summary: {
          occupying,
          seatCount: seats.length,
          openParents: fifoQueue.length,
          openChildSlots: openSeatCount,
          cyclesInFeed: cyclesOut.length,
          featureReserve: balances.featureReserve,
          adminAllocation: balances.adminAllocation,
          nextFill,
        },
        seats,
        fifoQueue,
        recentCycles: cyclesOut,
        howItWorks: [
          'New join or same-pool re-entry claims the oldest open child seat (FIFO by queueSequence).',
          'When both left and right fill, that seat cycles: wallet / same-pool / next-pool / admin / feature split.',
          'Cycles 1–14: same participation re-enters as a filler child (not a new WAITING parent).',
          'Referral SN is independent of matrix parent — who referred you ≠ who you sit under.',
        ],
      },
    });
  } catch (err) {
    return mapError(err, res);
  }
};

/**
 * Full journey for one participation: seats, cycles, ledgers, referral.
 * GET /autopool/admin/participations/:id/journey
 */
exports.getParticipationJourney = async (req, res) => {
  try {
    const id = req.params.id;
    const participation = await AutopoolParticipation.findById(id)
      .populate('userId', 'name email serialNumber')
      .lean();
    if (!participation) {
      return res.status(404).json({ success: false, message: 'Participation not found' });
    }

    const [seats, cycles, ledgers, referral, eligibility] = await Promise.all([
      AutopoolPlacement.find({ participationId: id }).sort({ queueSequence: 1 }).lean(),
      AutopoolCycle.find({ participationId: id }).sort({ cycleNumber: 1 }).lean(),
      AutopoolLedger.find({ participationId: id }).sort({ createdAt: 1 }).lean(),
      AutopoolReferralEvent.findOne({ participationId: id })
        .populate('referrerUserId', 'name serialNumber')
        .lean(),
      AutopoolNextPoolEligibility.findOne({ sourceParticipationId: id }).lean(),
    ]);

    // Resolve parent labels for each seat
    const parentIds = [
      ...new Set(
        seats
          .map((s) => (s.parentParticipationId ? String(s.parentParticipationId) : null))
          .filter(Boolean)
      ),
    ];
    const parentParts = parentIds.length
      ? await AutopoolParticipation.find({ _id: { $in: parentIds } })
          .populate('userId', 'name serialNumber')
          .lean()
      : [];
    const parentMap = {};
    parentParts.forEach((p) => {
      parentMap[String(p._id)] = p.userId
        ? {
            participationId: p._id,
            name: p.userId.name,
            serialNumber: p.userId.serialNumber,
          }
        : { participationId: p._id };
    });

    const seatOut = seats.map((s) => ({
      placementId: s._id,
      queueSequence: s.queueSequence,
      slot: s.slot,
      status: s.status,
      openSlots: s.openSlots,
      generation: s.generation ?? 0,
      leftChildParticipationId: s.leftChildParticipationId,
      rightChildParticipationId: s.rightChildParticipationId,
      parentParticipationId: s.parentParticipationId,
      parentUser: s.parentParticipationId
        ? parentMap[String(s.parentParticipationId)] || null
        : null,
      isCurrentSeat: String(participation.placementId) === String(s._id),
      filledAt: s.filledAt,
    }));

    const currentSeat = seatOut.find((s) => s.isCurrentSeat) || seatOut[seatOut.length - 1] || null;

    return res.json({
      success: true,
      data: {
        participation: {
          _id: participation._id,
          poolLevel: participation.poolLevel,
          status: participation.status,
          cycleCount: participation.cycleCount,
          entryType: participation.entryType,
          entryAmount: participation.entryAmount,
          nextPoolEligibleAmount: participation.nextPoolEligibleAmount,
          isBootstrap: participation.isBootstrap,
          releasedAt: participation.releasedAt,
          startedAt: participation.startedAt,
          completedAt: participation.completedAt,
          maxCycles: participation.configSnapshot?.maxCycles ?? 15,
          user: participation.userId,
        },
        currentSeat,
        seats: seatOut,
        cycles,
        ledgers,
        referral: referral
          ? {
              referrerSerialNumber: referral.referrerSerialNumber,
              referrer: referral.referrerUserId,
              createdAt: referral.createdAt,
            }
          : null,
        eligibility,
        note: 'Referral SN is who they used at join. Matrix parent is who they sit under (FIFO).',
      },
    });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.bootstrap = async (req, res) => {
  try {
    let userId = req.body?.userId;
    if (!userId && req.body?.serialNumber != null) {
      const u = await User.findOne({
        serialNumber: Number(String(req.body.serialNumber).replace(/^#/, '')),
      });
      if (!u) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      userId = u._id;
    }
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId or serialNumber required' });
    }
    const result = await bootstrapRootUser({
      userId,
      adminUserId: req.user._id,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.seed = async (req, res) => {
  try {
    const configs = await seedPoolConfigs();
    await ensureSettings();
    await ensureSystemBalances();
    return res.json({ success: true, data: { configs } });
  } catch (err) {
    return mapError(err, res);
  }
};
