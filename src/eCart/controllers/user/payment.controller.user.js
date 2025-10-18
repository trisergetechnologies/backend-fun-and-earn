const mongoose = require('mongoose');
const crypto = require('crypto');
require('dotenv').config();

const WalletTransaction = require('../../../models/WalletTransaction');
const User = require('../../../models/User');
const Product = require('../../models/Product');
const PaymentIntent = require('../../models/PaymentIntent');
const Order = require('../../models/Order');
const Razorpay = require('razorpay');

const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;

exports.verifyPayment = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, paymentIntentId } = req.body;
  const user = req.user;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !paymentIntentId) {
    return res.status(200).json({
      success: false,
      message: 'Missing required payment details'
    });
  }

  // Step 1: Verify signature authenticity
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(200).json({
      success: false,
      message: 'Invalid payment signature. Verification failed.'
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Step 2: Fetch PaymentIntent
    const paymentIntent = await PaymentIntent.findById(paymentIntentId).session(session);
    if (!paymentIntent) {
      throw new Error('PaymentIntent not found');
    }

    // Idempotency: if already captured, return success silently
    if (paymentIntent.status === 'captured') {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({
        success: true,
        message: 'Payment already verified',
        data: { orderId: paymentIntent.referenceId }
      });
    }

    // Step 3: Validate Razorpay order match
    if (paymentIntent.razorpayOrderId !== razorpay_order_id) {
      throw new Error('Mismatched orderId between Razorpay and system records');
    }

    // Step 4: Update PaymentIntent
    paymentIntent.status = 'captured';
    paymentIntent.razorpayPaymentId = razorpay_payment_id;
    paymentIntent.razorpaySignature = razorpay_signature;
    paymentIntent.meta.verifiedAt = new Date();
    await paymentIntent.save({ session });

    // Step 5: Update linked Order
    const order = await Order.findById(paymentIntent.referenceId).session(session);
    if (!order) {
      throw new Error('Linked order not found for payment');
    }

    order.paymentStatus = 'paid';
    order.paymentInfo.paymentId = razorpay_payment_id;
    order.paymentInfo.gateway = 'razorpay';
    order.finalAmountPaid = paymentIntent.amount;
    order.trackingUpdates.push({
      status: 'placed',
      note: 'Payment verified via Razorpay'
    });

    await order.save({ session });

    // Step 6: Commit transaction
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: 'Payment verified and order confirmed',
      data: {
        orderId: order._id,
        paymentId: razorpay_payment_id,
        amount: paymentIntent.amount
      }
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('verifyPayment error:', err.message);

    // Update PaymentIntent to failed
    await PaymentIntent.findByIdAndUpdate(paymentIntentId, {
      status: 'failed',
      meta: { failureReason: err.message }
    });

    return res.status(500).json({
      success: false,
      message: `Payment verification failed: ${err.message}`
    });
  }
};


/**
 * Handles Razorpay payment.captured event
 */
async function handlePaymentCaptured(intent, paymentPayload) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const order = await Order.findById(intent.referenceId).session(session);
    if (!order) throw new Error('Order not found for PaymentIntent');

    // Already processed?
    if (intent.status === 'captured' || order.paymentStatus === 'paid') {
      console.log(`[Webhook] Order ${order._id} already marked as paid`);
      await session.commitTransaction();
      session.endSession();
      return;
    }

    // Update PaymentIntent
    intent.status = 'captured';
    intent.razorpayPaymentId = paymentPayload.id;
    intent.meta.webhookCapturedAt = new Date();
    await intent.save({ session });

    // Update Order
    order.paymentStatus = 'paid';
    order.status = 'placed'
    order.paymentInfo.paymentId = paymentPayload.id;
    order.paymentInfo.gateway = 'razorpay';
    order.finalAmountPaid = intent.amount;
    order.trackingUpdates.push({
      status: 'placed',
      note: 'Auto-confirmed via Razorpay webhook'
    });
    await order.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(`[Webhook] ✅ Payment captured for Order ${order._id}`);

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(`[Webhook] handlePaymentCaptured error: ${err.message}`);
  }
}

/**
 * Handles Razorpay payment.failed event
 */
async function handlePaymentFailed(intent, paymentPayload) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const order = await Order.findById(intent.referenceId).session(session);
    if (!order) throw new Error('Order not found for PaymentIntent');

    console.log(`[Webhook] ❌ Payment failed for Order ${order._id}`);

    // Refund wallet if used
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
        toWallet: null,
        amount: order.usedWalletAmount,
        status: 'success',
        triggeredBy: 'system',
        notes: `Auto refund due to Razorpay payment failed (Order ${order._id})`
      }], { session });
    }

    // Restore stock
    for (const item of order.items) {
      await Product.findByIdAndUpdate(
        item.productId,
        { $inc: { stock: item.quantity } },
        { session }
      );
    }

    // Update records
    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    order.trackingUpdates.push({
      status: 'cancelled',
      note: 'Payment failed - cancelled via webhook'
    });
    await order.save({ session });

    intent.status = 'failed';
    intent.meta.webhookFailedAt = new Date();
    await intent.save({ session });

    await session.commitTransaction();
    session.endSession();

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(`[Webhook] handlePaymentFailed error: ${err.message}`);
  }
}

/**
 * Handles refund.processed event (future use)
 */
async function handleRefundProcessed(intent, refundPayload) {
  try {
    intent.status = 'refunded';
    intent.meta.refund = refundPayload;
    await intent.save();
    console.log(`[Webhook] 💸 Refund processed for PaymentIntent ${intent._id}`);
  } catch (err) {
    console.error(`[Webhook] handleRefundProcessed error: ${err.message}`);
  }
}


const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

/**
 * @route POST /api/payment/webhook
 * @desc Razorpay webhook handler (handles auto-captured, failed, or refunded payments)
 */
exports.paymentWebhook = async (req, res) => {
  try {
    console.log('webhook hit !!');
    const webhookSignature = req.headers['x-razorpay-signature'];
    // const rawBody = JSON.stringify(req.body);
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);

    // Step 1️⃣ — Verify webhook authenticity
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== webhookSignature) {
      console.error('[Webhook] Invalid signature detected');
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }

    const event = req.body.event;
    const payload = req.body.payload?.payment?.entity;

    if (!payload) {
      return res.status(400).json({ success: false, message: 'Invalid webhook payload' });
    }

    console.log(`[Webhook] Received event: ${event}, payment_id: ${payload.id}`);

    // Step 2️⃣ — Find matching PaymentIntent
    const intent = await PaymentIntent.findOne({
      razorpayOrderId: payload.order_id
    });

    if (!intent) {
      console.warn('[Webhook] No matching PaymentIntent found for order_id:', payload.order_id);
      return res.status(200).json({ success: true, message: 'No matching PaymentIntent found (ignored)' });
    }

    // Step 3️⃣ — Process events
    if (event === 'payment.captured') {
      await handlePaymentCaptured(intent, payload);
    }
    else if (event === 'payment.failed') {
      await handlePaymentFailed(intent, payload);
    }
    else if (event === 'refund.processed') {
      await handleRefundProcessed(intent, payload);
    }
    else {
      console.log('[Webhook] Ignored event type:', event);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET
});



exports.verifyOrderStatus = async (req, res) => {
  const { razorpayOrderId } = req.params;

  if (!razorpayOrderId) {
    return res.status(200).json({ success: false, message: 'Missing Razorpay order ID' });
  }

  try {
    // Try fetching the order details from Razorpay
    const order = await razorpay.orders.fetch(razorpayOrderId);
    const payments = await razorpay.orders.fetchPayments(razorpayOrderId);

    // Calculate order age (seconds since creation)
    const createdAt = order?.created_at ? new Date(order.created_at * 1000) : null;
    const ageSeconds = createdAt ? Math.floor((Date.now() - createdAt.getTime()) / 1000) : null;

    // Quick heuristics
    const hasCaptured = payments?.items?.some((p) => p.status === 'captured');
    const hasFailed = payments?.items?.every((p) => p.status === 'failed');
    const hasAuthorized = payments?.items?.some((p) => p.status === 'authorized');

    // default decision
    let decision = 'WAIT';
    let reason = 'pending';
    let orderStatus = order.status; // created / paid / attempted

    if (hasCaptured || order.status === 'paid') {
      decision = 'SUCCESS';
      reason = 'Payment captured';
    } else if (hasFailed || order.status === 'failed') {
      decision = 'FAIL';
      reason = 'Payment failed';
    } else if (hasAuthorized) {
      // sometimes Razorpay lingers in authorized before capture
      decision = 'WAIT';
      reason = 'Authorized but not captured yet';
    } else if (order.status === 'attempted' && ageSeconds && ageSeconds > 120) {
      // Attempted for >2 mins, still no capture
      decision = 'FAIL';
      reason = 'Payment attempt timed out (>120s)';
    } else if (order.status === 'created' && ageSeconds && ageSeconds > 120) {
      // Never attempted even after 2 mins
      decision = 'FAIL';
      reason = 'No payment attempt after 2 mins';
    }

    // 🔁 Optionally update local PaymentIntent for tracking
    const paymentIntent = await PaymentIntent.findOne({ razorpayOrderId });
    if (paymentIntent) {
      // update meta fields only (idempotent)
      paymentIntent.meta = paymentIntent.meta || {};
      paymentIntent.meta.lastVerifyStatus = {
        decision,
        orderStatus,
        ageSeconds,
        checkedAt: new Date()
      };

      if (decision === 'SUCCESS' && paymentIntent.status !== 'captured') {
        paymentIntent.status = 'captured';
      } else if (decision === 'FAIL' && paymentIntent.status === 'created') {
        paymentIntent.status = 'failed';
      }

      await paymentIntent.save();

      // If linked order exists, reflect status there (optional)
      if (paymentIntent.referenceId && decision === 'FAIL') {
        await Order.findByIdAndUpdate(paymentIntent.referenceId, {
          paymentStatus: 'failed',
          status: 'cancelled'
        });
      }
    }

    return res.status(200).json({
      success: true,
      decision,
      orderStatus,
      reason,
      ageSeconds
    });
  } catch (err) {
    console.error('[verifyOrderStatus] Error:', err.message);
    return res.status(500).json({
      success: false,
      decision: 'WAIT',
      message: 'Failed to verify Razorpay order status',
      error: err.message
    });
  }
};



exports.markPaymentFailed = async (req, res) => {
  const { paymentIntentId, reason = 'cancelled_by_user' } = req.body;
  const user = req.user;

  if (!paymentIntentId) {
    return res.status(400).json({
      success: false,
      message: 'paymentIntentId is required'
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const intent = await PaymentIntent.findById(paymentIntentId).session(session);
    if (!intent) throw new Error('PaymentIntent not found');

    // Idempotent check — if already captured or failed, just return
    if (['captured', 'failed', 'cancelled'].includes(intent.status)) {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({
        success: true,
        message: `PaymentIntent already marked as ${intent.status}`,
        status: intent.status
      });
    }

    // Mark as failed
    intent.status = 'failed';
    intent.meta = intent.meta || {};
    intent.meta.failedReason = reason;
    intent.meta.failedAt = new Date();
    await intent.save({ session });

    // If linked order exists, mark it cancelled + rollback any wallet deduction / stock
    if (intent.referenceId) {
      const order = await Order.findById(intent.referenceId).session(session);
      if (order) {
        order.paymentStatus = 'failed';
        order.status = 'cancelled';
        order.trackingUpdates.push({
          status: 'cancelled',
          note: `Payment marked failed (${reason})`
        });
        await order.save({ session });

        // refund wallet if used
        if (order.usedWalletAmount && order.usedWalletAmount > 0) {
          await User.findByIdAndUpdate(
            order.buyerId,
            { $inc: { 'wallets.eCartWallet': order.usedWalletAmount } },
            { session }
          );

          await WalletTransaction.create(
            [
              {
                userId: order.buyerId,
                type: 'earn',
                source: 'system',
                fromWallet: 'eCartWallet',
                amount: order.usedWalletAmount,
                status: 'success',
                triggeredBy: 'system',
                notes: `Refunded wallet (payment failed: ${reason})`
              }
            ],
            { session }
          );
        }

        // restore stock
        for (const item of order.items) {
          await Product.findByIdAndUpdate(
            item.productId,
            { $inc: { stock: item.quantity } },
            { session }
          );
        }
      }
    }

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: 'PaymentIntent and Order marked as failed successfully'
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('[markPaymentFailed] error:', err.message);
    return res.status(500).json({
      success: false,
      message: `Failed to mark payment as failed: ${err.message}`
    });
  }
};
