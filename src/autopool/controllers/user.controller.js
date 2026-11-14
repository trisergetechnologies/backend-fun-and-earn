const {
  joinPool1Manual,
  joinPoolManual,
  bootstrapRootUser,
} = require('../services/entry.service');
const {
  getOverview,
  getPoolDetail,
  getCredits,
  getReferrals,
  getParticipationDetail,
} = require('../services/overview.service');
const {
  listAchieverPools,
  getPoolAchievers,
} = require('../services/achievers.service');

const AUTO_JOIN_MESSAGE =
  'Pool upgrades are automatic now. You will be upgraded when your turn comes in the waiting room and you have a referral pass.';

function mapError(err, res) {
  const code = err.code || 'AUTOPOOL_ERROR';
  const statusByCode = {
    AUTOPOOL_DISABLED: 403,
    NO_PACKAGE: 400,
    INSUFFICIENT_WALLET: 400,
    INSUFFICIENT_COUPON_CREDIT: 400,
    POOL_OCCUPYING: 409,
    INVALID_SN: 400,
    SELF_REFERRAL: 400,
    REFERRER_NOT_ACTIVE: 400,
    POOL_INACTIVE: 400,
    NO_ELIGIBILITY: 400,
    NO_UPGRADE_CREDIT: 400,
    TARGET_OCCUPYING: 409,
    INVALID_POOL: 400,
    USER_NOT_FOUND: 404,
    LEGAL_NOTICE_REQUIRED: 400,
    AUTO_JOIN_ENABLED: 400,
    NO_OTHER_OCCUPYING: 400,
    WAITING_ROOM_PENDING: 409,
  };
  const status = statusByCode[code] || 500;
  return res.status(status).json({
    success: false,
    code,
    message: err.message || 'Autopool error',
  });
}

exports.getOverview = async (req, res) => {
  try {
    const data = await getOverview(req.user._id);
    return res.json({ success: true, data });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.getPool = async (req, res) => {
  try {
    const data = await getPoolDetail(req.user._id, req.params.level);
    return res.json({ success: true, data });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.getParticipation = async (req, res) => {
  try {
    const data = await getParticipationDetail(req.user._id, req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    return res.json({ success: true, data });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.getCredits = async (req, res) => {
  try {
    const data = await getCredits(req.user._id);
    return res.json({ success: true, data });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.getReferrals = async (req, res) => {
  try {
    const data = await getReferrals(req.user._id);
    return res.json({ success: true, data });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.joinPool1 = async (req, res) => {
  try {
    const { referrerSerialNumber, idempotencyKey, legalNoticeAccepted } = req.body || {};
    if (referrerSerialNumber === undefined || referrerSerialNumber === null || referrerSerialNumber === '') {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SN',
        message: 'referrerSerialNumber is required',
      });
    }
    const result = await joinPool1Manual({
      userId: req.user._id,
      referrerSerialNumber,
      idempotencyKey: idempotencyKey || req.headers['idempotency-key'],
      legalNoticeAccepted: Boolean(legalNoticeAccepted),
    });
    return res.status(result.alreadyProcessed ? 200 : 201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.getAchieverPools = async (req, res) => {
  try {
    const pools = await listAchieverPools();
    return res.json({ success: true, data: { pools } });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.getPoolAchievers = async (req, res) => {
  try {
    const data = await getPoolAchievers(req.params.level);
    return res.json({ success: true, data });
  } catch (err) {
    return mapError(err, res);
  }
};

/** Soft-closed: upgrades run via Waiting Room cron. Old apps get a clear message. */
exports.joinNext = async (req, res) => {
  return res.status(400).json({
    success: false,
    code: 'AUTO_JOIN_ENABLED',
    message: AUTO_JOIN_MESSAGE,
  });
};

/** Manual DreamMart entry for Pool 2 or 3 (no SN / no referrer credit). */
exports.joinPoolManual = async (req, res) => {
  try {
    const level = Number(req.params.level);
    const { idempotencyKey, legalNoticeAccepted } = req.body || {};
    const result = await joinPoolManual({
      userId: req.user._id,
      poolLevel: level,
      idempotencyKey: idempotencyKey || req.headers['idempotency-key'],
      legalNoticeAccepted: Boolean(legalNoticeAccepted),
    });
    return res.status(result.alreadyProcessed ? 200 : 201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.bootstrapRootUser = bootstrapRootUser;
