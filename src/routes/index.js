const express = require('express');
const router = express.Router();

//common router imports
const authRouter = require('./auth.routes');

//eCart router import
const eCartRouter = require('../eCart/routes');
const shortVideoRouter = require('../shortVideo/routes');
const { handleOrangeCallback, handlePaymentAdvice } = require('../eCart/controllers/user/orangepg.controller.user');

//Common Routes
router.use('/auth', authRouter);

//eCart Routes
router.use('/ecart', eCartRouter);
router.use('/shortvideo', shortVideoRouter);


// Orange PG payment callback (Form POST from Orange PG after payment)
router.post('/public/orange/callback', handleOrangeCallback);

// Orange PG payment advice webhook (async notification from bank)
router.post('/public/orange/paymentadvice', handlePaymentAdvice);



module.exports = router;