const express = require('express');
const { verifyPayment } = require('../../controllers/user/payment.controller.user');
const userPaymentRouter = express.Router();

userPaymentRouter.post('/verifypayment', verifyPayment);

module.exports = userPaymentRouter;