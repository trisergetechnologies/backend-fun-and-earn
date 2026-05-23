const Express = require('express');
const userCouponRouter = require('./coupon.routes.user');
const userPackageRouter = require('./package.routes.user');
const userTreeRouter = require('./tree.routes.user');
const userVideoRouter = require('./video.routes.user');
const userWatchRouter = require('./watch.routes.user');
const userRewardsRouter = require('./rewards.routes.user');
const userAdsRouter = require('./ads.routes.user');

const shortVideoUserRouter = Express.Router();

shortVideoUserRouter.use('/coupon', userCouponRouter);
shortVideoUserRouter.use('/package', userPackageRouter);
shortVideoUserRouter.use('/tree', userTreeRouter);
shortVideoUserRouter.use('/video', userVideoRouter);
shortVideoUserRouter.use('/watch', userWatchRouter);
shortVideoUserRouter.use('/rewards', userRewardsRouter);
shortVideoUserRouter.use('/ads', userAdsRouter);

module.exports = shortVideoUserRouter;
