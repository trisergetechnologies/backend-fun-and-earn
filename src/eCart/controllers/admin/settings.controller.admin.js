const Settings = require('../../../models/Settings');

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
      'freeDeliveryAbove'
    ];

    const updateData = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
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
