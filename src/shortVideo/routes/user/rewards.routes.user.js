'use strict';

const express = require('express');
const {
  getPayoutEligible,
  getTopEarners,
} = require('../../controllers/user/rewards.controller.user');

const userRewardsRouter = express.Router();

userRewardsRouter.get('/payout-eligible', getPayoutEligible);
userRewardsRouter.get('/top-earners', getTopEarners);

module.exports = userRewardsRouter;
