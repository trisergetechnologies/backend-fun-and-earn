const express = require('express');
const router = express.Router();

//common router imports
const authRouter = require('./auth.routes');

//eCart router import
const eCartRouter = require('../eCart/routes');
const shortVideoRouter = require('../shortVideo/routes');
const { handleOrangeCallback, handlePaymentAdvice } = require('../eCart/controllers/user/orangepg.controller.user');
const { handleCcavenueCallback, handleCcavenueCancel } = require('../eCart/controllers/user/ccavenue.controller.user');

function logCcavenueHttp(req, label) {
  console.log(`[CCAvenue HTTP] ${label}`, JSON.stringify({
    method: req.method,
    path: req.originalUrl,
    contentType: req.headers['content-type'],
    bodyKeys: Object.keys(req.body || {}),
    queryKeys: Object.keys(req.query || {})
  }));
}

//Common Routes
router.use('/auth', authRouter);

//eCart Routes
router.use('/ecart', eCartRouter);
router.use('/shortvideo', shortVideoRouter);

// Orange PG payment callback (Form POST from Orange PG after payment)
router.post('/public/orange/callback', handleOrangeCallback);

// Orange PG payment advice webhook (async notification from bank)
router.post('/public/orange/paymentadvice', handlePaymentAdvice);

// CCAvenue payment callbacks (public — no auth)
router.post('/public/ccavenue/callback', (req, res, next) => {
  logCcavenueHttp(req, 'POST callback');
  next();
}, handleCcavenueCallback);

router.post('/public/ccavenue/cancel', (req, res, next) => {
  logCcavenueHttp(req, 'POST cancel');
  next();
}, handleCcavenueCancel);

router.get('/public/ccavenue/callback', (req, res, next) => {
  logCcavenueHttp(req, 'GET callback (unexpected — CCAvenue should POST encResp)');
  next();
}, handleCcavenueCallback);

router.get('/public/ccavenue/cancel', (req, res, next) => {
  logCcavenueHttp(req, 'GET cancel (unexpected)');
  next();
}, handleCcavenueCancel);

module.exports = router;
