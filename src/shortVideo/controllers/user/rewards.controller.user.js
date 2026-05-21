'use strict';

const { getPayoutEligibleUsers } = require('../../services/rewardsPayoutEligible.service');
const { getTopEarnersPage } = require('../../services/topEarners.service');

exports.getPayoutEligible = async (req, res) => {
  try {
    const { poolType, page = 1, limit = 20 } = req.query;

    if (!poolType || !['weekly', 'monthly'].includes(poolType)) {
      return res.status(200).json({
        success: false,
        message: 'poolType must be weekly or monthly',
        data: null,
      });
    }

    const data = await getPayoutEligibleUsers({
      poolType,
      page: Number(page),
      limit: Number(limit),
    });

    return res.status(200).json({
      success: true,
      message: 'Payout-ready members fetched successfully',
      data,
    });
  } catch (err) {
    console.error('getPayoutEligible Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

const TOP_EARNERS_MAX = 15;

exports.getTopEarners = async (req, res) => {
  try {
    const requested = Number(req.query.limit) || TOP_EARNERS_MAX;
    const data = await getTopEarnersPage({
      page: 1,
      limit: Math.min(TOP_EARNERS_MAX, Math.max(1, requested)),
    });

    return res.status(200).json({
      success: true,
      message: 'Top earners fetched successfully',
      data,
    });
  } catch (err) {
    console.error('getTopEarners Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};
