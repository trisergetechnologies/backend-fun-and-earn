const Settings = require('../../../models/Settings');
const {
  validateAdsSettingsUpdate,
  clampDailyLimit,
} = require('../../../shortVideo/services/adsPolicy.service');

exports.getSettings = async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    return res.status(200).json({
      success: true,
      message: 'Settings fetched successfully',
      data: settings
    });
  } catch (err) {
    console.error('Get Settings Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const allowedFields = [
      'minWithdrawalAmount',
      'autoSyncDays',
      'monthlyPayoutDay',
      'referralBonus',
      'deliveryMode',
      'deliveryChargeAmount',
      'freeDeliveryAbove',
      'adsDailyInterstitialLimit',
      'adsBannerEnabled',
    ];

    const adsErrors = validateAdsSettingsUpdate(req.body);
    if (adsErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: adsErrors.join('; '),
        data: null,
      });
    }

    const updateData = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }
    if (updateData.adsDailyInterstitialLimit !== undefined) {
      updateData.adsDailyInterstitialLimit = clampDailyLimit(
        updateData.adsDailyInterstitialLimit
      );
    }
    updateData.updatedAt = Date.now();

    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create(updateData);
    } else {
      Object.assign(settings, updateData);
      await settings.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      data: settings
    });
  } catch (err) {
    console.error('Update Settings Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};
