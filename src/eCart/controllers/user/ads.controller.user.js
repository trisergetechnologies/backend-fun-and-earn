const {
  buildMartAdConfigPayload,
  consumeMartInterstitialSlot,
} = require('../../services/dreamMartAdsPolicy.service');

exports.getAdConfig = async (req, res) => {
  try {
    const userId = req.user._id;
    const data = await buildMartAdConfigPayload(userId);
    return res.status(200).json({
      success: true,
      message: 'Ad config fetched successfully',
      data,
    });
  } catch (err) {
    console.error('getMartAdConfig Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

exports.consumeInterstitial = async (req, res) => {
  try {
    const userId = req.user._id;
    const data = await consumeMartInterstitialSlot(userId);
    return res.status(200).json({
      success: true,
      message: data.allowed
        ? 'Interstitial slot reserved'
        : 'Daily interstitial limit reached',
      data,
    });
  } catch (err) {
    console.error('consumeMartInterstitial Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};
