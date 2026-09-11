const {
  e2eAllowed,
  provisionUser,
  resetE2eAutopoolData,
  bootstrapPoolParticipation,
  placeFillerInPool,
  advanceCycles,
} = require('../services/e2e.service');
const User = require('../../models/User');

function mapError(err, res) {
  const statusByCode = {
    E2E_FORBIDDEN: 403,
    E2E_EMAIL_INVALID: 400,
    POOL_OCCUPYING: 409,
    POOL_INACTIVE: 400,
    USER_NOT_FOUND: 404,
    NO_PARTICIPATION: 404,
    ADVANCE_STUCK: 500,
  };
  const status = statusByCode[err.code] || 500;
  return res.status(status).json({
    success: false,
    code: err.code || 'E2E_ERROR',
    message: err.message || 'E2E error',
  });
}

exports.provision = async (req, res) => {
  try {
    if (!e2eAllowed()) {
      return res.status(403).json({
        success: false,
        code: 'E2E_FORBIDDEN',
        message: 'E2E helpers disabled',
      });
    }
    const {
      email,
      password,
      eCartBalance,
      packageName,
      name,
      referredBy,
      withPackage,
    } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'email required' });
    }
    const data = await provisionUser({
      email,
      password,
      eCartBalance,
      packageName,
      name,
      referredBy,
      withPackage: withPackage !== false,
    });
    return res.status(201).json({ success: true, data });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.reset = async (req, res) => {
  try {
    const data = await resetE2eAutopoolData({
      deleteUsers: Boolean(req.body?.deleteUsers),
    });
    return res.json({ success: true, data });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.bootstrapPool = async (req, res) => {
  try {
    let userId = req.body?.userId;
    if (!userId && req.body?.email) {
      const u = await User.findOne({ email: req.body.email });
      if (!u) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      userId = u._id;
    }
    if (!userId || !req.body?.poolLevel) {
      return res.status(400).json({
        success: false,
        message: 'userId/email and poolLevel required',
      });
    }
    const data = await bootstrapPoolParticipation({
      userId,
      poolLevel: req.body.poolLevel,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.placeFiller = async (req, res) => {
  try {
    let userId = req.body?.userId;
    if (!userId && req.body?.email) {
      const u = await User.findOne({ email: req.body.email });
      if (!u) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      userId = u._id;
    }
    if (!userId || !req.body?.poolLevel) {
      return res.status(400).json({
        success: false,
        message: 'userId/email and poolLevel required',
      });
    }
    const data = await placeFillerInPool({
      userId,
      poolLevel: req.body.poolLevel,
    });
    return res.status(201).json({ success: true, data });
  } catch (err) {
    return mapError(err, res);
  }
};

exports.advanceCycles = async (req, res) => {
  try {
    let userId = req.body?.userId;
    if (!userId && req.body?.email) {
      const u = await User.findOne({ email: req.body.email });
      if (!u) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      userId = u._id;
    }
    if (!userId || !req.body?.poolLevel || req.body?.targetCycleCount == null) {
      return res.status(400).json({
        success: false,
        message: 'userId/email, poolLevel, targetCycleCount required',
      });
    }
    const data = await advanceCycles({
      userId,
      poolLevel: req.body.poolLevel,
      targetCycleCount: req.body.targetCycleCount,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return mapError(err, res);
  }
};
