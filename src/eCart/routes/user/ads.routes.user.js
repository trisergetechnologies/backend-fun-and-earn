const Express = require('express');
const {
  getAdConfig,
  consumeInterstitial,
} = require('../../controllers/user/ads.controller.user');

const userAdsRouter = Express.Router();

userAdsRouter.get('/config', getAdConfig);
userAdsRouter.post('/consume', consumeInterstitial);

module.exports = userAdsRouter;
