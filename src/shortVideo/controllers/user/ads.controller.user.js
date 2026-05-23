const {
  buildAdConfigPayload,
  consumeInterstitialSlot,
} = require('../../services/adsPolicy.service');

exports.getAdConfig = async (req, res) => {
  try {
    const userId = req.user._id;
    const data = await buildAdConfigPayload(userId);
    return res.status(200).json({
      success: true,
      message: 'Ad config fetched successfully',
      data,
    });
  } catch (err) {
    console.error('getAdConfig Error:', err);
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
    const data = await consumeInterstitialSlot(userId);
    return res.status(200).json({
      success: true,
      message: data.allowed
        ? 'Interstitial slot reserved'
        : 'Daily interstitial limit reached',
      data,
    });
  } catch (err) {
    console.error('consumeInterstitial Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};
