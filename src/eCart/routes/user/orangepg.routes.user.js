// ================================================================
// FILE: routes/user/orangepg.routes.user.js
// Orange PG Routes
// ================================================================

const express = require('express');
const { initiateOrangeSale, verifyOrangePaymentStatus, handleOrangeCallback, handlePaymentAdvice} = require('../../controllers/user/orangepg.controller.user');

const orangePGRouter = express.Router();

// ============================================================
// PROTECTED ROUTES (require authentication)
// ============================================================

// POST /api/v1/ecart/user/payment/orange/initiate
// Initiate Orange PG sale (calls Orange PG API and returns redirect URL)
orangePGRouter.post('/initiate', initiateOrangeSale);

// GET /api/v1/ecart/user/payment/orange/verify/:paymentIntentId
// Verify payment status (used for polling after redirect)
orangePGRouter.get('/verify/:paymentIntentId', verifyOrangePaymentStatus);


// ============================================================
// PUBLIC ROUTES (webhooks/callbacks from Orange PG)
// ============================================================

// POST /api/v1/ecart/user/payment/orange/callback
// Orange PG payment callback (Form POST from Orange PG after payment)
orangePGRouter.post('/callback', handleOrangeCallback);

// POST /api/v1/ecart/user/payment/orange/paymentadvice
// Orange PG payment advice webhook (async notification from bank)
orangePGRouter.post('/paymentadvice', handlePaymentAdvice);


module.exports = orangePGRouter;
