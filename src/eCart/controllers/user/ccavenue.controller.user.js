const mongoose = require('mongoose');
const PaymentIntent = require('../../models/PaymentIntent');
const Order = require('../../models/Order');
const Product = require('../../models/Product');
const Cart = require('../../models/Cart');
const User = require('../../../models/User');
const WalletTransaction = require('../../../models/WalletTransaction');
const {
  decrypt,
  parseDecryptedResponse,
  buildOrderParams,
  buildPaymentPageUrl,
  assertCcavenueConfig,
  getCallbackUrls,
  CCAVENUE_ENV,
  CCAVENUE_WORKING_KEY,
  BACKEND_URL
} = require('../../helpers/ccavenue.helper');

const FRONTEND_URL = process.env.FRONTEND_URL || 'dreammart://';
const LOG_PREFIX = '[CCAvenue]';

function log(step, payload = {}) {
  console.log(`${LOG_PREFIX} ${step}`, typeof payload === 'string' ? payload : JSON.stringify(payload));
}

async function handleCcavenuePaymentSuccess(intent, orderId, paymentDetails) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const freshIntent = await PaymentIntent.findById(intent._id).session(session);
    if (!freshIntent) throw new Error('PaymentIntent not found');

    if (freshIntent.status === 'captured') {
      log('payment_success_skipped', { paymentIntentId: intent._id?.toString(), reason: 'already captured' });
      await session.commitTransaction();
      session.endSession();
      return;
    }

    if (freshIntent.status === 'failed' || freshIntent.status === 'expired') {
      log('payment_success_skipped', {
        paymentIntentId: intent._id?.toString(),
        reason: `intent already ${freshIntent.status} — not resurrecting`,
      });
      await session.commitTransaction();
      session.endSession();
      return;
    }

    freshIntent.status = 'captured';
    freshIntent.meta = freshIntent.meta || {};
    freshIntent.meta.ccavenue = {
      ...(freshIntent.meta.ccavenue || {}),
      ...paymentDetails,
      capturedAt: new Date()
    };
    await freshIntent.save({ session });

    const order = await Order.findById(orderId).session(session);
    if (!order) throw new Error('Order not found');

    order.paymentStatus = 'paid';
    order.status = 'placed';
    order.paymentInfo.gateway = 'ccavenue';
    order.paymentInfo.paymentId = paymentDetails.trackingId || paymentDetails.bankRefNo || paymentDetails.orderId;
    order.finalAmountPaid = paymentDetails.amount ?? freshIntent.amount;
    order.trackingUpdates.push({
      status: 'placed',
      note: `Payment verified via CCAvenue (tracking: ${paymentDetails.trackingId || 'N/A'})`
    });
    await order.save({ session });

    await Cart.deleteOne({ userId: order.buyerId }).session(session);

    await session.commitTransaction();
    session.endSession();
    log('payment_success', {
      paymentIntentId: intent._id?.toString(),
      orderId: orderId?.toString(),
      trackingId: paymentDetails.trackingId,
      amount: paymentDetails.amount
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    log('payment_success_error', { error: err.message });
    throw err;
  }
}

async function handleCcavenuePaymentFailure(intent, orderId, reason) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const freshIntent = await PaymentIntent.findById(intent._id).session(session);
    if (!freshIntent) throw new Error('PaymentIntent not found');

    if (freshIntent.status === 'failed' || freshIntent.status === 'captured') {
      log('payment_failure_skipped', {
        paymentIntentId: intent._id?.toString(),
        status: freshIntent.status
      });
      await session.commitTransaction();
      session.endSession();
      return;
    }

    const order = await Order.findById(orderId).session(session);
    if (!order) throw new Error('Order not found');

    for (const item of order.items) {
      await Product.findByIdAndUpdate(
        item.productId,
        { $inc: { stock: item.quantity } },
        { session }
      );
    }

    if (order.usedWalletAmount > 0) {
      await User.findByIdAndUpdate(
        order.buyerId,
        { $inc: { 'wallets.eCartWallet': order.usedWalletAmount } },
        { session }
      );

      await WalletTransaction.create([{
        userId: order.buyerId,
        type: 'earn',
        source: 'system',
        fromWallet: 'eCartWallet',
        amount: order.usedWalletAmount,
        status: 'success',
        triggeredBy: 'system',
        notes: `Refund - CCAvenue payment failed: ${reason}`
      }], { session });
    }

    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    order.trackingUpdates.push({
      status: 'cancelled',
      note: `CCAvenue payment failed: ${reason}`
    });
    await order.save({ session });

    freshIntent.status = 'failed';
    freshIntent.meta = freshIntent.meta || {};
    freshIntent.meta.ccavenue = {
      ...(freshIntent.meta.ccavenue || {}),
      failedAt: new Date(),
      failureReason: reason
    };
    await freshIntent.save({ session });

    await session.commitTransaction();
    session.endSession();
    log('payment_failure', {
      paymentIntentId: intent._id?.toString(),
      orderId: orderId?.toString(),
      reason
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    log('payment_failure_error', { error: err.message });
    throw err;
  }
}

function isSuccessStatus(orderStatus) {
  const status = (orderStatus || '').toLowerCase();
  return status === 'success' || status === 'successful' || status === 'shipped';
}

async function processCcavenueResponse(encResp) {
  log('process_response_start', { encRespLength: encResp?.length || 0 });

  const decrypted = decrypt(encResp, CCAVENUE_WORKING_KEY);
  const params = parseDecryptedResponse(decrypted);

  log('process_response_decrypted', {
    order_id: params.order_id,
    order_status: params.order_status,
    tracking_id: params.tracking_id,
    merchant_param1: params.merchant_param1,
    merchant_param2: params.merchant_param2,
    status_code: params.status_code
  });

  const paymentIntentId = params.merchant_param2;
  const orderId = params.merchant_param1;

  if (!paymentIntentId || !mongoose.Types.ObjectId.isValid(paymentIntentId)) {
    throw new Error('Invalid payment intent reference in CCAvenue response');
  }

  const intent = await PaymentIntent.findById(paymentIntentId);
  if (!intent) {
    throw new Error('PaymentIntent not found');
  }

  if (intent.meta?.ccavenue?.orderId && params.order_id && intent.meta.ccavenue.orderId !== params.order_id) {
    throw new Error('CCAvenue order_id mismatch');
  }

  const paymentDetails = {
    orderId: params.order_id,
    trackingId: params.tracking_id,
    bankRefNo: params.bank_ref_no,
    orderStatus: params.order_status,
    failureMessage: params.failure_message,
    paymentMode: params.payment_mode,
    amount: params.amount ? parseFloat(params.amount) : intent.amount,
    statusCode: params.status_code,
    statusMessage: params.status_message
  };

  if (isSuccessStatus(params.order_status)) {
    await handleCcavenuePaymentSuccess(intent, orderId || intent.referenceId, paymentDetails);
    return { success: true, intent, orderId: orderId || intent.referenceId, params };
  }

  const reason = params.failure_message || params.status_message || params.order_status || 'Payment failed';
  await handleCcavenuePaymentFailure(intent, orderId || intent.referenceId, reason);
  return { success: false, intent, orderId: orderId || intent.referenceId, params, reason };
}

exports.handleCcavenueCallback = async (req, res) => {
  log('callback_received', {
    method: req.method,
    contentType: req.headers['content-type'],
    bodyKeys: Object.keys(req.body || {}),
    queryKeys: Object.keys(req.query || {})
  });

  try {
    const encResp =
      req.body?.encResp ||
      req.body?.enc_response ||
      req.query?.encResp ||
      req.query?.enc_response;

    if (!encResp) {
      log('callback_missing_encResp', { body: req.body, query: req.query });
      return res.status(400).send('<h1>Bad Request - Missing encResp</h1>');
    }

    const result = await processCcavenueResponse(encResp);
    const orderId = result.orderId;

    if (result.success) {
      log('callback_redirect_success', { orderId: orderId?.toString() });
      return res.redirect(`${FRONTEND_URL}--/private/success?orderId=${orderId}`);
    }

    log('callback_redirect_failure', { orderId: orderId?.toString(), reason: result.reason });
    return res.redirect(`${FRONTEND_URL}--/private/checkout?error=${encodeURIComponent(result.reason || 'payment_failed')}`);
  } catch (err) {
    log('callback_error', { error: err.message, stack: err.stack });
    return res.status(500).send(`<h1>Payment processing error</h1><p>${err.message}</p>`);
  }
};

exports.handleCcavenueCancel = async (req, res) => {
  log('cancel_received', {
    method: req.method,
    contentType: req.headers['content-type'],
    bodyKeys: Object.keys(req.body || {}),
    queryKeys: Object.keys(req.query || {})
  });

  try {
    const encResp =
      req.body?.encResp ||
      req.body?.enc_response ||
      req.query?.encResp ||
      req.query?.enc_response;

    if (encResp) {
      try {
        const result = await processCcavenueResponse(encResp);
        if (!result.success) {
        log('cancel_redirect_failure', { reason: result.reason });
          return res.redirect(`${FRONTEND_URL}--/private/checkout?error=${encodeURIComponent(result.reason || 'cancelled')}`);
        }
        log('cancel_redirect_success', { orderId: result.orderId?.toString() });
        return res.redirect(`${FRONTEND_URL}--/private/success?orderId=${result.orderId}`);
      } catch (innerErr) {
        log('cancel_decrypt_error', { error: innerErr.message });
      }
    }

    const paymentIntentId = req.body?.merchant_param2 || req.query?.merchant_param2;
    if (paymentIntentId && mongoose.Types.ObjectId.isValid(paymentIntentId)) {
      const intent = await PaymentIntent.findById(paymentIntentId);
      if (intent && intent.status === 'created') {
        await handleCcavenuePaymentFailure(intent, intent.referenceId, 'cancelled_by_user');
      }
    }

    log('cancel_user_aborted', { paymentIntentId });
    return res.redirect(`${FRONTEND_URL}--/private/checkout?error=cancelled_by_user`);
  } catch (err) {
    log('cancel_error', { error: err.message });
    return res.status(500).send(`<h1>Cancel processing error</h1>`);
  }
};

exports.initiateCcavenuePayment = async (req, res) => {
  const { paymentIntentId } = req.body;
  const user = req.user;

  if (!paymentIntentId) {
    return res.status(400).json({ success: false, message: 'paymentIntentId is required' });
  }

  try {
    assertCcavenueConfig();

    const intent = await PaymentIntent.findOne({
      _id: paymentIntentId,
      userId: user._id,
      gateway: 'ccavenue',
      status: 'created'
    });

    if (!intent) {
      return res.status(404).json({ success: false, message: 'PaymentIntent not found or already processed' });
    }

    const order = await Order.findById(intent.referenceId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Linked order not found' });
    }

    if (intent.meta?.ccavenue?.paymentPageUrl) {
      return res.status(200).json({
        success: true,
        message: 'CCAvenue payment already initiated',
        data: {
          paymentIntentId: intent._id,
          paymentPageUrl: intent.meta.ccavenue.paymentPageUrl,
          amount: intent.amount
        }
      });
    }

    const ccavenueOrderId = intent.meta?.ccavenue?.orderId;
    if (!ccavenueOrderId) {
      return res.status(400).json({ success: false, message: 'CCAvenue order not initialized on intent' });
    }

    const billing = {
      name: order.deliveryAddress?.fullName || user.name || 'Customer',
      address: order.deliveryAddress?.street || 'NA',
      city: order.deliveryAddress?.city || 'NA',
      state: order.deliveryAddress?.state || 'NA',
      zip: order.deliveryAddress?.pincode || '000000',
      country: 'India',
      phone: order.deliveryAddress?.phone || user.phone || '9999999999',
      email: user.email || 'customer@dreammart.com'
    };

    const orderParams = buildOrderParams({
      orderId: ccavenueOrderId,
      amount: intent.amount,
      currency: intent.currency,
      billing,
      merchantParam1: order._id.toString(),
      merchantParam2: intent._id.toString()
    });

    const paymentPageUrl = buildPaymentPageUrl(orderParams);

    intent.meta = intent.meta || {};
    intent.meta.ccavenue = {
      ...(intent.meta.ccavenue || {}),
      orderId: ccavenueOrderId,
      paymentPageUrl,
      initiatedAt: new Date()
    };
    await intent.save();

    return res.status(200).json({
      success: true,
      message: 'CCAvenue payment initiated',
      data: {
        paymentIntentId: intent._id,
        paymentPageUrl,
        amount: intent.amount
      }
    });
  } catch (err) {
    console.error('[initiateCcavenuePayment] error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.verifyCcavenuePaymentStatus = async (req, res) => {
  const { paymentIntentId } = req.params;
  const user = req.user;

  try {
    const intent = await PaymentIntent.findOne({
      _id: paymentIntentId,
      userId: user._id,
      gateway: 'ccavenue'
    });

    if (!intent) {
      log('verify_not_found', { paymentIntentId, userId: user._id?.toString() });
      return res.status(404).json({
        success: false,
        decision: 'FAIL',
        message: 'PaymentIntent not found'
      });
    }

    if (intent.status === 'captured') {
      log('verify_success', { paymentIntentId, orderId: intent.referenceId?.toString() });
      return res.status(200).json({
        success: true,
        decision: 'SUCCESS',
        status: 'captured',
        orderId: intent.referenceId,
        message: 'Payment already verified'
      });
    }

    if (intent.status === 'failed') {
      log('verify_fail', {
        paymentIntentId,
        reason: intent.meta?.ccavenue?.failureReason
      });
      return res.status(200).json({
        success: true,
        decision: 'FAIL',
        status: 'failed',
        orderId: intent.referenceId,
        message: intent.meta?.ccavenue?.failureReason || 'Payment failed'
      });
    }

    log('verify_wait', {
      paymentIntentId,
      intentStatus: intent.status,
      ccavenueOrderId: intent.meta?.ccavenue?.orderId,
      hint: 'callback not received yet — expect POST /public/ccavenue/callback'
    });

    return res.status(200).json({
      success: true,
      decision: 'WAIT',
      status: intent.status,
      orderId: intent.referenceId,
      message: 'Payment still pending — waiting for CCAvenue callback'
    });
  } catch (err) {
    log('verify_error', { paymentIntentId, error: err.message });
    return res.status(500).json({
      success: false,
      decision: 'WAIT',
      message: 'Failed to verify payment status'
    });
  }
};

/** Log config at startup for debugging */
log('config', {
  CCAVENUE_ENV,
  BACKEND_URL,
  callbackUrls: getCallbackUrls(),
  FRONTEND_URL
});

exports.handleCcavenuePaymentSuccess = handleCcavenuePaymentSuccess;
exports.handleCcavenuePaymentFailure = handleCcavenuePaymentFailure;
exports.processCcavenueResponse = processCcavenueResponse;
