const {
  joinPool1Manual,
  bootstrapRootUser,
} = require('../services/entry.service');
const { joinNextPool } = require('../services/joinNext.service');
const {
  getOverview,
  getPoolDetail,
  getCredits,
  getReferrals,
  getParticipationDetail,
} = require('../services/overview.service');

function mapError(err, res) {
  const code = err.code || 'AUTOPOOL_ERROR';
  const statusByCode = {
    AUTOPOOL_DISABLED: 403,
    NO_PACKAGE: 400,
    INSUFFICIENT_WALLET: 400,
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

exports.joinNext = async (req, res) => {
  try {
    const level = Number(req.params.level);
    const { idempotencyKey } = req.body || {};
    const result = await joinNextPool({
      userId: req.user._id,
      targetPoolLevel: level,
      idempotencyKey: idempotencyKey || req.headers['idempotency-key'],
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
