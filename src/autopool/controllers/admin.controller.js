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
