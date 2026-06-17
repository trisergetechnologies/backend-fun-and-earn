const express = require('express');
const {
  initiateCcavenuePayment,
  verifyCcavenuePaymentStatus
} = require('../../controllers/user/ccavenue.controller.user');

const ccavenueRouter = express.Router();

ccavenueRouter.post('/initiate', initiateCcavenuePayment);
ccavenueRouter.get('/verify/:paymentIntentId', verifyCcavenuePaymentStatus);

module.exports = ccavenueRouter;
