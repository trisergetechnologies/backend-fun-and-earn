const express = require('express');
const { verifyPayment, verifyOrderStatus, markPaymentFailed } = require('../../controllers/user/payment.controller.user');
const userPaymentRouter = express.Router();

userPaymentRouter.post('/verifypayment', verifyPayment);
userPaymentRouter.get('/verifystatus/:razorpayOrderId', verifyOrderStatus);
userPaymentRouter.post('/markfailed', markPaymentFailed);

module.exports = userPaymentRouter;