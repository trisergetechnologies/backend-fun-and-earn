// jobs/expireCcavenuePayments.js
'use strict';

const mongoose = require('mongoose');
const PaymentIntent = require('../eCart/models/PaymentIntent');
const Order = require('../eCart/models/Order');
const Product = require('../eCart/models/Product');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const cron = require('node-cron');

require('dotenv').config();

const LOG_PREFIX = '[ExpireCCAvenue]';

/**
 * Expire unpaid CCAvenue payment intents past expiresAt.
 * Refunds wallet holds and restores reserved stock.
 */
async function expireCcavenuePayments() {
  const now = new Date();
  const staleIntents = await PaymentIntent.find({
    gateway: 'ccavenue',
    status: 'created',
    expiresAt: { $lt: now },
  }).limit(50);

  if (!staleIntents.length) return;

  console.log(`${LOG_PREFIX} Found ${staleIntents.length} expired CCAvenue intent(s)`);

  for (const intent of staleIntents) {
    try {
      await markExpiredIntentFailed(intent, 'CCAvenue intent expired — auto cleanup');
    } catch (err) {
      console.error(`${LOG_PREFIX} Error on intent ${intent._id}:`, err.message);
    }
  }
}

async function markExpiredIntentFailed(intent, reason) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const freshIntent = await PaymentIntent.findById(intent._id).session(session);
    if (!freshIntent) {
      await session.abortTransaction();
      session.endSession();
      return;
    }

    if (['captured', 'failed', 'expired', 'refunded'].includes(freshIntent.status)) {
      await session.abortTransaction();
      session.endSession();
      return;
    }

    const order = await Order.findById(freshIntent.referenceId).session(session);
    if (!order) {
      freshIntent.status = 'failed';
      freshIntent.meta = freshIntent.meta || {};
      freshIntent.meta.expiredAt = new Date();
      freshIntent.meta.expireNote = reason;
      await freshIntent.save({ session });
      await session.commitTransaction();
      session.endSession();
      return;
    }

    if (order.paymentStatus === 'paid') {
      await session.abortTransaction();
      session.endSession();
      return;
    }

    if (order.paymentStatus === 'pending') {
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

        await WalletTransaction.create(
          [
            {
              userId: order.buyerId,
              type: 'earn',
              source: 'system',
              fromWallet: 'eCartWallet',
              toWallet: null,
              amount: order.usedWalletAmount,
              status: 'success',
              triggeredBy: 'system',
              notes: `Auto refund (CCAvenue intent expired: ${freshIntent._id})`,
            },
          ],
          { session }
        );
      }

      order.paymentStatus = 'failed';
      order.status = 'cancelled';
      order.trackingUpdates.push({
        status: 'cancelled',
        note: reason,
      });
      await order.save({ session });
    }

    freshIntent.status = 'failed';
    freshIntent.meta = freshIntent.meta || {};
    freshIntent.meta.expiredAt = new Date();
    freshIntent.meta.expireNote = reason;
    await freshIntent.save({ session });

    await session.commitTransaction();
    session.endSession();
    console.log(`${LOG_PREFIX} Marked intent ${freshIntent._id} failed (${reason})`);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

cron.schedule('*/5 * * * *', async () => {
  try {
    await expireCcavenuePayments();
  } catch (err) {
    console.error(`${LOG_PREFIX} cron error:`, err.message);
  }
});

module.exports = { expireCcavenuePayments, markExpiredIntentFailed };
