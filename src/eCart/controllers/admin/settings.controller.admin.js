const Settings = require('../../../models/Settings');
const {
  validateAdsSettingsUpdate,
  clampDailyLimit,
} = require('../../../shortVideo/services/adsPolicy.service');
const {
  validateDreamMartAdsSettingsUpdate,
  applyDreamMartAdsClamps,
} = require('../../services/dreamMartAdsPolicy.service');

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
      'dreamMartAdsDailyInterstitialLimit',
      'dreamMartAdsMinGapSeconds',
      'dreamMartAdsBannerEnabled',
      'dreamMartAdsBannerVisibleSecondsPerDay',
      'paymentGateway',
    ];

    if (req.body.paymentGateway !== undefined) {
      const gateway = String(req.body.paymentGateway).toLowerCase().trim();
      if (gateway !== 'ccavenue' && gateway !== 'razorpay') {
        return res.status(400).json({
          success: false,
          message: 'paymentGateway must be ccavenue or razorpay',
          data: null,
        });
      }
      req.body.paymentGateway = gateway;
    }

    const adsErrors = validateAdsSettingsUpdate(req.body);
    const martAdsErrors = validateDreamMartAdsSettingsUpdate(req.body);
    const allErrors = [...adsErrors, ...martAdsErrors];
    if (allErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: allErrors.join('; '),
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
    applyDreamMartAdsClamps(updateData);
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
