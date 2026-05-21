'use strict';

const {
  getAchievementOverview,
  listAchievements,
} = require('../../services/adminAchievements.service');
const { getAdminPayoutEligible } = require('../../services/adminPayoutEligible.service');

function adminGuard(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(200).json({
      success: false,
      message: 'Unauthorized',
      data: null,
    });
    return false;
  }
  return true;
}

exports.getAchievementsOverview = async (req, res) => {
  try {
    if (!adminGuard(req, res)) return;

    const poolType = req.query.poolType === 'monthly' ? 'monthly' : 'weekly';
    const weekly = await getAchievementOverview('weekly');
    const monthly = await getAchievementOverview('monthly');

    return res.status(200).json({
      success: true,
      message: 'Achievement overview fetched',
      data: {
        selected: poolType,
        weekly,
        monthly,
      },
    });
  } catch (err) {
    console.error('getAchievementsOverview Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

exports.listAchievements = async (req, res) => {
  try {
    if (!adminGuard(req, res)) return;

    const poolType =
      req.query.poolType === 'monthly' ? 'monthly' : 'weekly';

    const data = await listAchievements({
      poolType,
      page: req.query.page,
      limit: req.query.limit,
      level: req.query.level,
      search: req.query.search,
      sortField: req.query.sortField,
      sortOrder: req.query.sortOrder,
    });

    return res.status(200).json({
      success: true,
      message: 'Achievements fetched',
      data,
    });
  } catch (err) {
    console.error('listAchievements Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

exports.getPayoutEligible = async (req, res) => {
  try {
    if (!adminGuard(req, res)) return;

    const poolType =
      req.query.poolType === 'monthly' ? 'monthly' : 'weekly';

    const data = await getAdminPayoutEligible({
      poolType,
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      level: req.query.level,
    });

    return res.status(200).json({
      success: true,
      message: 'Payout-eligible members fetched',
      data,
    });
  } catch (err) {
    console.error('admin getPayoutEligible Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};
