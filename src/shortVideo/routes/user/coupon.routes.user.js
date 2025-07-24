const express = require('express');
const { redeemCoupon } = require('../../controllers/user/coupon.controller.user');
const userCouponRouter = express.Router();

userCouponRouter.post('/redeemcoupon', redeemCoupon);

module.exports = userCouponRouter;