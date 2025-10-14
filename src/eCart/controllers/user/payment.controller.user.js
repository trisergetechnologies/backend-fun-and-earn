const mongoose = require('mongoose');
const crypto = require('crypto');
require('dotenv').config();

const WalletTransaction = require('../../../models/WalletTransaction');
const User = require('../../../models/User');
const Product = require('../../models/Product');
const PaymentIntent = require('../../models/PaymentIntent');
const Order = require('../../models/Order');

const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

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