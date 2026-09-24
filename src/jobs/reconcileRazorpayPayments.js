// jobs/reconcileRazorpayPayments.js
console.log("🔥 reconcileRazorpayPayments loaded");
'use strict';

const Razorpay = require('razorpay');
const mongoose = require('mongoose');
const PaymentIntent = require('../eCart/models/PaymentIntent');
const Order = require('../eCart/models/Order');
const Product = require('../eCart/models/Product');
const Cart = require('../eCart/models/Cart');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const cron = require('node-cron');

require('dotenv').config();

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET
});

/**
 * Poll Razorpay API for stale intents and reconcile them.
 * Run this job every 10–15 minutes via node-cron or a system scheduler.
 */
async function reconcileRazorpayPayments() {
  // console.log(`[Reconcile] Starting Razorpay payment reconciliation at ${new Date().toISOString()}`);

  const cutoffTime = new Date(Date.now() - 15 * 60 * 1000); // older than 15 mins

  const staleIntents = await PaymentIntent.find({
    status: { $in: ['created', 'authorized'] },
    expiresAt: { $lt: new Date() } // already past expiry window
  }).limit(50);

  // console.log(`[Reconcile] Found ${staleIntents.length} stale payment intents.`);

  for (const intent of staleIntents) {
    try {
      if (!intent.razorpayOrderId) continue;

      // 1️⃣ Fetch all payments for that Razorpay order
      const payments = await razorpay.orders.fetchPayments(intent.razorpayOrderId);

      if (!payments || !payments.items || payments.items.length === 0) {
        // console.log(`[Reconcile] No payments found for order ${intent.razorpayOrderId}`);
        await markAsFailed(intent, 'No payments attempted.');
        continue;
      }

      // 2️⃣ Check if any succeeded
      const capturedPayment = payments.items.find(p => p.status === 'captured');
      const allFailed = payments.items.every(p => p.status === 'failed' || p.status === 'created');

      if (capturedPayment) {
        await markAsPaid(intent, capturedPayment);
        continue;
      }

      if (allFailed) {
        // console.log(`[Reconcile] All payment attempts failed for order ${intent.razorpayOrderId}`);
        await markAsFailed(intent, 'All payment attempts failed (auto-reconcile).');
      } else {
        // console.log(`[Reconcile] Payment still pending for order ${intent.razorpayOrderId}`);
      }
    } catch (err) {
      console.error(`[Reconcile] Error checking intent ${intent._id}:`, err.message);
    }
  }

  // console.log(`[Reconcile] Razorpay reconciliation complete.`);
}

/**
 * Mirror webhook handlePaymentCaptured: intent → captured, order → paid.
 * Does NOT touch isPackageCronProcessed (packageBuyCron handles package).
 */
async function markAsPaid(intent, capturedPayment) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const freshIntent = await PaymentIntent.findById(intent._id).session(session);
    if (!freshIntent) throw new Error('PaymentIntent not found');

    const order = await Order.findById(freshIntent.referenceId).session(session);
    if (!order) throw new Error('Order not found for PaymentIntent');

    // Idempotent: already paid/captured (e.g. webhook won the race)
    if (freshIntent.status === 'captured' || order.paymentStatus === 'paid') {
      await session.commitTransaction();
      session.endSession();
      console.log(`[Reconcile] Intent ${freshIntent._id} already paid/captured — skip`);
      return;
    }

    const paymentId = capturedPayment.id;

    freshIntent.status = 'captured';
    freshIntent.razorpayPaymentId = paymentId;
    freshIntent.meta = freshIntent.meta || {};
    freshIntent.meta.reconciledAt = new Date();
    freshIntent.meta.reconcileNote = 'Marked paid via reconcile (Razorpay captured)';
    await freshIntent.save({ session });

    order.paymentStatus = 'paid';
    order.status = 'placed';
    order.paymentInfo = order.paymentInfo || {};
    order.paymentInfo.paymentId = paymentId;
    order.paymentInfo.gateway = 'razorpay';
    order.finalAmountPaid = freshIntent.amount;
    order.trackingUpdates.push({
      status: 'placed',
      note: 'Auto-confirmed via Razorpay reconcile job'
    });
    await order.save({ session });

    await Cart.deleteOne({ userId: order.buyerId }).session(session);

    await session.commitTransaction();
    session.endSession();

    console.log(`[Reconcile] Marked intent ${freshIntent._id} / order ${order._id} as paid (payment ${paymentId})`);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(`[Reconcile] Failed to mark intent ${intent._id} as paid:`, err.message);
  }
}

async function markAsFailed(intent, reason) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findById(intent.referenceId).session(session);
    if (!order) throw new Error('Order not found for PaymentIntent');

    // Restore stock
    for (const item of order.items) {
      await Product.findByIdAndUpdate(
        item.productId,
        { $inc: { stock: item.quantity } },
        { session }
      );
    }

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
        notes: `Auto refund (intent expired/failed during reconcile job)`
      }], { session });
    }

    // Update Order + Intent
    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    order.trackingUpdates.push({
      status: 'cancelled',
      note: reason
    });
    await order.save({ session });

    intent.status = 'failed';
    intent.meta = intent.meta || {};
    intent.meta.reconciledAt = new Date();
    intent.meta.reconcileNote = reason;
    await intent.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(`[Reconcile] Marked intent ${intent._id} as failed (reason: ${reason})`);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(`[Reconcile] Failed to mark intent ${intent._id} as failed:`, err.message);
  }
}

cron.schedule('*/10 * * * *', async () => {
    await reconcileRazorpayPayments();
  });