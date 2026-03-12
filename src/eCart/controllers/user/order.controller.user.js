const mongoose = require('mongoose');
const Razorpay = require('razorpay');

const Cart = require('../../models/Cart');
const User = require('../../../models/User');
const Product = require('../../models/Product');
const Order = require('../../models/Order');
const WalletTransaction = require('../../../models/WalletTransaction');
const { verifyPayment, logFailedPayment } = require('../../helpers/payment');

const moment = require('moment');
const PDFDocument = require('pdfkit');
const fs = require("fs");
const path = require("path");
const PaymentIntent = require('../../models/PaymentIntent');
require('dotenv').config();


exports.placeOrder = async (req, res) => {
  const user = req.user;
  const { paymentId, deliverySlug } = req.body;

  if (!paymentId || !deliverySlug) {
    return res.status(400).json({
      success: false,
      message: 'Payment ID and delivery address slug are required',
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Verify payment
    const paymentInfo = await verifyPayment(paymentId);
    if (!paymentInfo || paymentInfo.status !== 'success') {
      throw new Error('Payment verification failed');
    }

    // 2. Get cart
    const cart = await Cart.findOne({ userId: user._id }).populate('items.productId');
    if (!cart || cart.items.length === 0) {
      throw new Error('Cart is empty');
    }

    // 3. Get address snapshot
    const userDoc = await User.findById(user._id);
    const address = userDoc.eCartProfile.addresses.find(a => a.slugName === deliverySlug);
    if (!address) {
      throw new Error('Delivery address not found');
    }

    const deliveryAddress = {
      addressName: address.addressName,
      fullName: address.fullName,
      street: address.street,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      phone: address.phone
    };

    // 4. Build order items
    let subtotal = 0;
    const orderItems = [];

    for (const item of cart.items) {
      const product = item.productId;

      if (!product || !product.isActive || product.stock < item.quantity) {
        throw new Error(`Product ${product?.title || 'unknown'} unavailable or insufficient stock`);
      }

      const itemTotal = product.finalPrice * item.quantity;
      subtotal += itemTotal;
      
      orderItems.push({
        productId: product._id,
        sellerId: product.sellerId,
        quantity: item.quantity,
        priceAtPurchase: product.price,
        finalPriceAtPurchase: product.finalPrice,
        productTitle: product.title,
        productThumbnail: product.images?.[0] || '',
        returnPolicyDays: product.returnPolicyDays || 3,
        selectedVariation: item.selectedVariation || []
      });

      // Deduct stock
      product.stock -= item.quantity;
      await product.save({ session });
    }
    let grossPayable = subtotal + cart.totalGstAmount + cart.deliveryCharge;

    // 5. Wallet usage
    let usedWalletAmount = 0;
    let finalAmountPaid = grossPayable;

    if (cart.useWallet && userDoc.wallets.eCartWallet > 0) {
      usedWalletAmount = Math.min(userDoc.wallets.eCartWallet, grossPayable);
      finalAmountPaid = grossPayable - usedWalletAmount;

      userDoc.wallets.eCartWallet -= usedWalletAmount;
      await userDoc.save({ session });

      // Log wallet transaction
      await WalletTransaction.create([{
        userId: user._id,
        type: 'spend',
        source: 'purchase',
        fromWallet: 'eCartWallet',
        toWallet: null,
        amount: usedWalletAmount,
        status: 'success',
        triggeredBy: 'user',
        notes: `Wallet used during order payment (paymentId: ${paymentId})`
      }], { session });
    }

    // 6. Create order
    const order = new Order({
      buyerId: user._id,
      items: orderItems,
      deliveryAddress,
      usedWalletAmount,
      totalAmount: subtotal,
      finalAmountPaid,
      deliveryCharge: cart.deliveryCharge,
      totalGstAmount: cart.totalGstAmount,
      paymentStatus: 'paid',
      status: 'placed',
      paymentInfo: {
        gateway: paymentInfo.gateway,
        paymentId
      }
    });

    await order.save({ session });

    // 7. Clear cart
    await Cart.deleteOne({ userId: user._id }, { session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: 'Order placed successfully',
      data: {
        orderId: order._id,
        totalAmount: subtotal,
        walletUsed: usedWalletAmount,
        paidAmount: finalAmountPaid,
        totalGstAmount: cart.totalGstAmount
      }
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    // Log failed payment
    await logFailedPayment({
      userId: user._id,
      paymentId,
      paidAmount: null,
      walletUsed: 0,
      reason: err.message
    });

    console.error('Order placement error:', err.message);
    return res.status(500).json({
      success: false,
      message: `Order failed: ${err.message}`
    });
  }
};




// config
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const HOLD_WINDOW_MINUTES = parseInt(process.env.ORDER_HOLD_WINDOW_MINUTES || '30', 10); // default 30 min

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET
});

function msFromNow(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

exports.createOrderIntent = async (req, res) => {
  const user = req.user;
  const { useWallet = false, deliverySlug, idempotencyKey } = req.body;

  if (!deliverySlug) {
    return res.status(200).json({ success: false, message: 'deliverySlug is required' });
  }

  // Step 0: Quick guard
  const session = await mongoose.startSession();

  try {
    // Idempotency: if idempotencyKey provided, return existing valid PaymentIntent
    if (idempotencyKey) {
      const existing = await PaymentIntent.findOne({
        userId: user._id,
        idempotencyKey,
        status: { $in: ['created','authorized'] } // still active intents
      });

      if (existing) {
        // find associated order if any
        const order = existing.referenceId ? await Order.findById(existing.referenceId) : null;
        return res.status(200).json({
          success: true,
          message: 'Existing intent found',
          data: {
            paymentIntentId: existing._id,
            razorpayOrderId: existing.razorpayOrderId,
            orderId: order?._id || null,
            amount: existing.amount,
            expiresAt: existing.expiresAt
          }
        });
      }
    }

    // Step 1: Load cart
    session.startTransaction();
    const cart = await Cart.findOne({ userId: user._id }).populate('items.productId').session(session);
    if (!cart || !cart.items || cart.items.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(200).json({ success: false, message: 'Cart is empty' });
    }

    // Step 2: Load user doc (with session)
    let userDoc = await User.findById(user._id).session(session);
    if (!userDoc) {
      throw new Error('User not found');
    }

    // Step 3: Get address snapshot
    const address = userDoc.eCartProfile?.addresses?.find(a => a.slugName === deliverySlug);
    if (!address) {
      throw new Error('Delivery address not found');
    }
    const deliveryAddress = {
      addressName: address.addressName,
      fullName: address.fullName,
      street: address.street,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      phone: address.phone
    };

    // Step 4: Build order items, validate stock
    let subtotal = 0;
    const orderItems = [];

    for (const item of cart.items) {
      const product = item.productId;
      if (!product || !product.isActive || product.stock < item.quantity) {
        throw new Error(`Product ${product?.title || 'unknown'} unavailable or insufficient stock`);
      }

      const itemTotal = product.finalPrice * item.quantity;
      subtotal += itemTotal;

      orderItems.push({
        productId: product._id,
        sellerId: product.sellerId,
        quantity: item.quantity,
        priceAtPurchase: product.price,
        finalPriceAtPurchase: product.finalPrice,
        productTitle: product.title,
        productThumbnail: product.images?.[0] || '',
        returnPolicyDays: product.returnPolicyDays || 3,
        selectedVariation: item.selectedVariation || []
      });
    }

    const grossPayable = subtotal + (cart.totalGstAmount || 0) + cart.deliveryCharge;

    // Step 5: Wallet usage — compute usedWallet but decrement atomically if > 0
    let usedWalletAmount = 0;
    let remaining = grossPayable;

    if (useWallet && userDoc.wallets?.eCartWallet > 0) {
      usedWalletAmount = Math.min(userDoc.wallets.eCartWallet, grossPayable);

      // Attempt atomic wallet decrement
      const updatedUser = await User.findOneAndUpdate(
        { _id: user._id, 'wallets.eCartWallet': { $gte: usedWalletAmount } },
        { $inc: { 'wallets.eCartWallet': -usedWalletAmount } },
        { new: true, session }
      );

      if (!updatedUser) {
        throw new Error('Insufficient wallet balance (concurrent change)');
      }

      // Create wallet transaction
      await WalletTransaction.create([{
        userId: user._id,
        type: 'spend',
        source: 'purchase',
        fromWallet: 'eCartWallet',
        toWallet: null,
        amount: usedWalletAmount,
        status: 'success',
        triggeredBy: 'user',
        notes: `Wallet used during order creation (idempotencyKey: ${idempotencyKey || 'none'})`
      }], { session });

      remaining = +(grossPayable - usedWalletAmount);
    }

    // Step 6: Deduct stock (reserve) inside transaction
    for (const item of cart.items) {
      const product = await Product.findById(item.productId._id).session(session);
      if (!product || product.stock < item.quantity) {
        throw new Error(`Product ${product?.title || 'unknown'} out of stock during reserve`);
      }
      product.stock -= item.quantity;
      await product.save({ session });
    }

    // Step 7: Create Order and PaymentIntent record
    // PaymentIntent created with status 'created' and will be updated with razorpayOrderId after commit
    const orderDoc = new Order({
      buyerId: user._id,
      items: orderItems,
      deliveryAddress,
      usedWalletAmount,
      totalAmount: subtotal,
      finalAmountPaid: remaining, // amount expected to be paid via Razorpay (0 if wallet covered)
      totalGstAmount: cart.totalGstAmount || 0,
      deliveryCharge: cart?.deliveryCharge || 0,
      paymentStatus: remaining > 0 ? 'pending' : 'paid',
      status: 'placed',
      paymentInfo: {
        gateway: remaining > 0 ? 'razorpay' : 'walletOnly',
        paymentId: null
      }
    });

    await orderDoc.save({ session });

    const expiresAt = msFromNow(HOLD_WINDOW_MINUTES);

    const paymentIntentDoc = new PaymentIntent({
      userId: user._id,
      purpose: 'order',
      referenceId: orderDoc._id,
      amount: remaining,
      currency: 'INR',
      status: remaining > 0 ? 'created' : 'captured', // if remaining 0, consider captured
      expiresAt: remaining > 0 ? expiresAt : new Date(),
      idempotencyKey: idempotencyKey || null
    });

    await paymentIntentDoc.save({ session });

    // Step 8: Clear cart only if wallet-only (remaining === 0), otherwise keep cart until payment confirmed
    if (remaining <= 0) {
      await Cart.deleteOne({ userId: user._id }, { session });
    }

    // Commit DB transaction: wallet deducted, stock reserved, order & paymentIntent stored
    await session.commitTransaction();
    session.endSession();

    // Step 9: If remaining > 0, create Razorpay order and update PaymentIntent (outside DB txn)
    if (remaining > 0) {
      try {

        const shortOrderId = orderDoc._id.toString().slice(-8); // last 8 chars only
        const callbackUrl = `https://amp-api.mpdreams.in/api/v1/payment/razorpay-redirect?intent=${paymentIntentDoc._id}`;
        
        const razorpayOrder = await razorpay.orders.create({
          amount: Math.round(remaining * 100), // paise
          currency: 'INR',
          receipt: `rcpt_${shortOrderId}_${Date.now().toString().slice(-5)}`,
          payment_capture: 1, // auto-capture
          notes: { callback_url: callbackUrl }
        });

        // update PaymentIntent with razorpayOrderId
        await PaymentIntent.findByIdAndUpdate(paymentIntentDoc._id, {
          razorpayOrderId: razorpayOrder.id,
          meta: { razorpayOrderPayload: razorpayOrder }
        }, { new: true });

        // Respond to client with order and razorpay details
        return res.status(200).json({
          success: true,
          message: 'Order intent created. Complete payment via Razorpay.',
          data: {
            orderId: orderDoc._id,
            paymentIntentId: paymentIntentDoc._id,
            razorpayOrderId: razorpayOrder.id,
            razorpayKeyId: RAZORPAY_KEY_ID,
            amount: remaining,
            currency: 'INR',
            callbackUrl,
            expiresAt
          }
        });

      } catch (razErr) {
        // Razorpay order creation failed — perform compensating rollback:
        // (1) mark PaymentIntent failed & expire
        // (2) restore stock and refund wallet (if used)
        console.error('Razorpay order creation failed:', razErr);

        // Compensation transaction
        const compSession = await mongoose.startSession();
        compSession.startTransaction();
        try {
          // mark paymentIntent failed
          await PaymentIntent.findByIdAndUpdate(paymentIntentDoc._id, {
            status: 'failed',
            meta: { error: razErr.message }
          }, { session: compSession });

          // restore stock
          for (const item of cart.items) {
            await Product.findByIdAndUpdate(item.productId._id, { $inc: { stock: item.quantity } }, { session: compSession });
          }

          // refund wallet if used
          if (usedWalletAmount > 0) {
            await User.findByIdAndUpdate(user._id, { $inc: { 'wallets.eCartWallet': usedWalletAmount } }, { session: compSession });

            await WalletTransaction.create([{
              userId: user._id,
              type: 'earn',
              source: 'system',
              fromWallet: 'eCartWallet',
              toWallet: null,
              amount: usedWalletAmount,
              status: 'success',
              triggeredBy: 'system',
              notes: 'Refund wallet due to Razorpay order creation failure'
            }], { session: compSession });
          }

          // mark order as cancelled due to payment system error
          await Order.findByIdAndUpdate(orderDoc._id, {
            paymentStatus: 'failed',
            status: 'cancelled'
          }, { session: compSession });

          await compSession.commitTransaction();
          compSession.endSession();

        } catch (compErr) {
          await compSession.abortTransaction();
          compSession.endSession();

          console.error('Compensation rollback failed:', compErr.message);
          // best-effort: log and continue to surface error
        }

        return res.status(500).json({
          success: false,
          message: 'Failed to initialize payment with Razorpay. Wallet refunded and order cancelled.',
          error: razErr.message
        });
      }
    } else {
      // remaining === 0 -> wallet-only order already placed and marked paid
      return res.status(200).json({
        success: true,
        message: 'Order placed successfully using wallet only',
        data: {
          orderId: orderDoc._id,
          paymentIntentId: paymentIntentDoc._id,
          totalAmount: subtotal,
          walletUsed: usedWalletAmount,
          paidAmount: 0,
          totalGstAmount: cart.totalGstAmount || 0
        }
      });
    }

  } catch (err) {
    // Abort main session if not ended
    try {
      await session.abortTransaction();
      session.endSession();
    } catch (e) {
      // ignore
    }

    console.error('createOrderIntent error:', err.message);
    
    return res.status(500).json({
      success: false,
      message: `Could not create order intent: ${err.message}`
    });
  }
};





exports.placeOrderWalletOnly = async (req, res) => {
  const user = req.user;
  const { deliverySlug } = req.body;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Get cart
    const cart = await Cart.findOne({ userId: user._id }).populate('items.productId');
    if (!cart || cart.items.length === 0) {
      throw new Error('Cart is empty');
    }

    // 2. Fetch user & address
    const userDoc = await User.findById(user._id);
    const address = userDoc.eCartProfile.addresses.find(a => a.slugName === deliverySlug);
    if (!address) {
      throw new Error('Delivery address not found');
    }

    const deliveryAddress = {
      addressName: address.addressName,
      fullName: address.fullName,
      street: address.street,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      phone: address.phone
    };

    // 3. Build order items
    let subtotal = 0;
    const orderItems = [];

    for (const item of cart.items) {
      const product = item.productId;

      if (!product || !product.isActive || product.stock < item.quantity) {
        throw new Error(`Product ${product?.title || 'unknown'} unavailable or insufficient stock`);
      }

      const itemTotal = product.finalPrice * item.quantity;
      subtotal += itemTotal;

      orderItems.push({
        productId: product._id,
        sellerId: product.sellerId,
        quantity: item.quantity,
        priceAtPurchase: product.price,
        finalPriceAtPurchase: product.finalPrice,
        productTitle: product.title,
        productThumbnail: product.images?.[0] || '',
        returnPolicyDays: product.returnPolicyDays || 3,
        selectedVariation: item.selectedVariation || []
      });

      // Deduct stock
      product.stock -= item.quantity;
      await product.save({ session });
    }

    // 4. Wallet check
    const walletBalance = userDoc.wallets.eCartWallet;
    if (walletBalance < subtotal) {
      throw new Error(`Insufficient wallet balance. Required INR${subtotal}, available INR${walletBalance}`);
    }

    const totalAmount = subtotal + cart.totalGstAmount + cart.deliveryCharge;

    userDoc.wallets.eCartWallet -= totalAmount;
    await userDoc.save({ session });

    // Log wallet transaction
    await WalletTransaction.create([{
      userId: user._id,
      type: 'spend',
      source: 'purchase',
      fromWallet: 'eCartWallet',
      toWallet: null,
      amount: subtotal,
      status: 'success',
      triggeredBy: 'user',
      notes: 'Wallet-only order'
    }], { session });

    // 5. Create order
    const order = new Order({
      buyerId: user._id,
      items: orderItems,
      deliveryAddress,
      usedWalletAmount: subtotal,
      totalAmount: subtotal,
      finalAmountPaid: 0,
      deliveryCharge: cart.deliveryCharge,
      totalGstAmount: cart.totalGstAmount,
      paymentStatus: 'paid',
      status: 'placed',
      paymentInfo: {
        gateway: 'walletOnly',
        paymentId: null
      }
    });

    await order.save({ session });

    // 6. Clear cart
    await Cart.deleteOne({ userId: user._id }, { session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: 'Order placed successfully using wallet only',
      data: {
        orderId: order._id,
        totalAmount: subtotal,
        paidAmount: 0,
        totalGstAmount: cart.totalGstAmount,
        walletUsed: subtotal
      }
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error('Wallet Order Error:', err.message);
    return res.status(500).json({
      success: false,
      message: `Wallet-only order failed: ${err.message}`
    });
  }
};




exports.getOrders = async (req, res) => {
  const userId = req.user._id;
  const orderId = req.query.id;

  try {
    let orders;

    if (orderId) {
      orders = await Order.findOne({ _id: orderId, buyerId: userId });
      if (!orders) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }
    } else {
      orders = await Order.find({ buyerId: userId }).sort({ createdAt: -1 });
    }

    return res.status(200).json({
      success: true,
      message: 'Order(s) fetched successfully',
      data: orders
    });

  } catch (err) {
    console.error('Get Orders Error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch orders'
    });
  }
};



exports.cancelOrder = async (req, res) => {
  const user = req.user;
  const { orderId, reason } = req.body;

  if (!orderId) {
    return res.status(400).json({
      success: false,
      message: 'Order ID is required'
    });
  }

  try {
    const order = await Order.findOne({ _id: orderId, buyerId: user._id });
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // ❌ Block if shipped or later
    if (!['placed', 'processing'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: 'Order cannot be cancelled after it is shipped'
      });
    }

    // ✅ Refund wallet if used
    if (order.usedWalletAmount > 0) {
      const userDoc = await User.findById(user._id);
      userDoc.wallets.eCartWallet += order.usedWalletAmount;
      await userDoc.save();

      await WalletTransaction.create({
        userId: user._id,
        type: 'refund',
        source: 'purchase',
        fromWallet: null,
        toWallet: 'eCartWallet',
        amount: order.usedWalletAmount,
        status: 'success',
        triggeredBy: 'system',
        notes: `Refund to wallet for cancelled order ${order._id}`
      });
    }

    // ✅ Handle bank refund — mark as pending
    let refundToBank = 0;
    if (order.finalAmountPaid > 0) {
      order.refundStatus = 'pending'; // Will be handled manually
      refundToBank = order.finalAmountPaid;
    }

    // ✅ Update order
    order.status = 'cancelled';
    order.cancelRequested = true;
    order.cancelReason = reason || 'Not specified';

    order.trackingUpdates = order.trackingUpdates || [];
    order.trackingUpdates.push({
      status: 'cancelled',
      updatedAt: new Date(),
      note: 'Order cancelled by user'
    });

    await order.save();

    return res.status(200).json({
      success: true,
      message: 'Order cancelled successfully',
      data: {
        orderId: order._id,
        refundToWallet: order.usedWalletAmount,
        refundToBank
      }
    });

  } catch (err) {
    console.error('Cancel Order Error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to cancel order'
    });
  }
};





// exports.downloadInvoice = async (req, res) => {
//   try {
//     const { orderId } = req.params;
//     const order = await Order.findById(orderId)
//       .populate("items.productId")
//       .populate("buyerId");
//     const addr = order.deliveryAddress;
//     if (!order) {
//       return res
//         .status(200)
//         .json({ success: false, message: "Order not found", data: null });
//     }

//     // ensure invoices folder exists (root level, same as uploads)
//     const invoicesDir = path.join(process.cwd(), "invoices");
//     if (!fs.existsSync(invoicesDir)) {
//       fs.mkdirSync(invoicesDir, { recursive: true });
//     }

//     // file path
//     const filePath = path.join(invoicesDir, `invoice-${order._id}.pdf`);

//     // 🔹 Agar purana invoice hai to delete karo
//     if (fs.existsSync(filePath)) {
//       fs.unlinkSync(filePath);
//       console.log(`Old invoice deleted: ${filePath}`);
//     }

//     const baseUrl = `https://${req.get('host')}`;
//     const publicUrl = `${baseUrl}/invoices/invoice-${order._id}.pdf`;

//     // Create PDF
//     const doc = new PDFDocument({ margin: 40 });
//     const writeStream = fs.createWriteStream(filePath);
//     doc.pipe(writeStream);

//     // ---------- BRAND HEADER ----------
//     doc
//       .rect(0, 0, doc.page.width, 80)
//       .fill("#10b981");

//     doc
//       .fillColor("#fff")
//       .fontSize(20)
//       .font("Helvetica-Bold")
//       .text("AARUSH MP DREAMS (OPC) Pvt. Ltd.", 40, 20);

//     doc
//       .fontSize(10)
//       .font("Helvetica")
//       .fillColor("#ecf0f1")
//       .text("No. 242, Araliganur, Siruguppa - 583121", 40, 45)
//       .text("GSTIN: 29ABBCA7044H1ZN", 40, 60);

//     doc.moveDown(3);

//     // ---------- INVOICE META ----------
//     doc
//       .fontSize(14)
//       .fillColor("#34495E")
//       .font("Helvetica-Bold")
//       .text("Invoice Details", { underline: true });

//     doc.moveDown(0.5);
//     doc
//       .font("Helvetica")
//       .fontSize(11)
//       .fillColor("#000")
//       .text(`Invoice #: ${order._id}`)
//       .text(`Invoice Date: ${moment(order.createdAt).format("DD/MM/YYYY")}`);

//     doc.moveDown(1.5);

//     // ---------- BILLING INFO ----------
//     doc
//       .fontSize(14)
//       .fillColor("#34495E")
//       .font("Helvetica-Bold")
//       .text("Billed To", { underline: true });

//     doc.moveDown(0.5);
//     doc
//       .font("Helvetica")
//       .fontSize(11)
//       .fillColor("#000")
//       .text(`${addr.fullName}`)
//       .text(`${addr.street}, ${addr.city}, ${addr.state} - ${addr.pincode}`)
//       .text(`${addr.phone}`);

//     doc.moveDown(2);

//     // ---------- ORDER ITEMS TABLE ----------
//     const tableTop = doc.y;
//     const startX = 40;
//     const colWidths = {
//       product: 200,
//       qty: 60,
//       price: 80,
//       gst: 80,
//       total: 100,
//     };

//     // Table Header
//     doc
//       .rect(startX - 5, tableTop - 5, 520, 25)
//       .fill("#ecf0f1")
//       .stroke();

//     doc
//       .fillColor("#10b981")
//       .font("Helvetica-Bold")
//       .fontSize(12)
//       .text("Product", startX, tableTop, { width: colWidths.product })
//       .text("Qty", startX + colWidths.product, tableTop, {
//         width: colWidths.qty,
//         align: "center",
//       })
//       .text("Price (INR)", startX + colWidths.product + colWidths.qty, tableTop, {
//         width: colWidths.price,
//         align: "right",
//       })
//       .text("GST (INR)", startX + colWidths.product + colWidths.qty + colWidths.price, tableTop, {
//         width: colWidths.gst,
//         align: "right",
//       })
//       .text("Total (INR)", startX + colWidths.product + colWidths.qty + colWidths.price + colWidths.gst, tableTop, {
//         width: colWidths.total,
//         align: "right",
//       });

//     doc.moveDown(1);
//     let yPos = doc.y + 5;

//     // Rows
//     doc.font("Helvetica").fontSize(11).fillColor("#000");
//     order.items.forEach((item, i) => {
//       const gstAmount = (item?.productId?.gst * item?.priceAtPurchase) * item.quantity;
//       const lineTotal = (item.finalPriceAtPurchase + (item?.productId?.gst * item?.priceAtPurchase)) * item.quantity;
//       const rowHeight = 22;
//       const rowY = yPos + i * rowHeight;

//       if (i % 2 === 0) {
//         doc.rect(startX - 5, rowY - 4, 520, rowHeight).fill("#fdfdfd").stroke();
//         doc.fillColor("#000");
//       }

//       doc.text(item.productTitle, startX, rowY, { width: colWidths.product });
//       doc.text(item.quantity.toString(), startX + colWidths.product, rowY, {
//         width: colWidths.qty,
//         align: "center",
//       });
//       doc.text(`INR ${item.priceAtPurchase?.toFixed(2)}`, startX + colWidths.product + colWidths.qty, rowY, {
//         width: colWidths.price,
//         align: "right",
//       });
//       doc.text(`INR ${gstAmount?.toFixed(2)}`, startX + colWidths.product + colWidths.qty + colWidths.price, rowY, {
//         width: colWidths.gst,
//         align: "right",
//       });
//       doc.text(`INR ${lineTotal?.toFixed(2)}`, startX + colWidths.product + colWidths.qty + colWidths.price + colWidths.gst, rowY, {
//         width: colWidths.total,
//         align: "right",
//       });

//       yPos = rowY;
//     });

//     doc.moveDown(3);

//     // ---------- SUMMARY BOX ----------
//     doc
//       .rect(startX - 5, doc.y - 5, 250, 70)
//       .stroke("#BDC3C7");

//     doc
//       .font("Helvetica-Bold")
//       .fontSize(12)
//       .fillColor("#34495E")
//       .text("Summary", startX, doc.y, { underline: true });

//     doc.moveDown(0.5);
//     doc
//       .font("Helvetica")
//       .fontSize(11)
//       .fillColor("#000")
//       .text(`Amount: INR ${(order.totalAmount - order.totalGstAmount)?.toFixed(2)}`)
//       .text(`GST: INR ${order.totalGstAmount?.toFixed(2)}`)
//       .text(`Final Total: INR ${order.finalAmountPaid?.toFixed(2)}`, {
//         underline: true,
//       });

//     doc.moveDown(2);

//     // ---------- FOOTER ----------
//     doc
//       .fontSize(9)
//       .fillColor("#7f8c8d")
//       .text("This is a system generated invoice under the GST rules of India. Dream Mart thanks you for your purchase and looks forward to serving you again!", { align: "center" });

//     doc.end();

//     // Wait until file is written before sending response
//     writeStream.on("finish", () => {
//       res.json({
//         success: true,
//         message: "Invoice generated",
//         url: publicUrl,
//       });
//     });
//   } catch (err) {
//     console.error("Invoice generation error:", err);
//     res.status(500).json({
//       success: false,
//       message: "Failed to generate invoice",
//       data: null,
//     });
//   }
// };

exports.downloadInvoice = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId)
      .populate("items.productId")
      .populate("buyerId");

    if (!order) {
      return res
        .status(200)
        .json({ success: false, message: "Order not found", data: null });
    }

    const addr = order.deliveryAddress;

    // Ensure invoices folder exists
    const invoicesDir = path.join(process.cwd(), "invoices");
    if (!fs.existsSync(invoicesDir)) {
      fs.mkdirSync(invoicesDir, { recursive: true });
    }

    const filePath = path.join(invoicesDir, `invoice-${order._id}.pdf`);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const baseUrl = `https://${req.get("host")}`;
    const publicUrl = `${baseUrl}/invoices/invoice-${order._id}.pdf`;

    // ─── PDF Setup ────────────────────────────────────────────────────────────
    const doc = new PDFDocument({ margin: 0, size: "A4" });
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    const PAGE_W = doc.page.width;
    const PAGE_H = doc.page.height;
    const M = 40; // margin
    const CW = PAGE_W - M * 2; // content width

    // ─── Palette ──────────────────────────────────────────────────────────────
    const G1        = "#10b981"; // primary green
    const G2        = "#059669"; // dark green
    const G3        = "#d1fae5"; // light green tint
    const INK       = "#0f172a"; // near black
    const INK2      = "#334155"; // secondary text
    const MUTED     = "#94a3b8"; // muted
    const BORDER    = "#e2e8f0";
    const BG_LIGHT  = "#f8fafc";
    const BG_STRIP  = "#f1f5f9";
    const WHITE     = "#ffffff";

    // ══════════════════════════════════════════════════════════════════════════
    // 1. HEADER — two-tone split
    // ══════════════════════════════════════════════════════════════════════════
    doc.rect(0, 0, PAGE_W, 90).fill(G2);
    doc.rect(PAGE_W - 180, 0, 180, 90).fill(G1);
    doc.rect(0, 90, PAGE_W, 4).fill(G3);

    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor(WHITE)
      .text("AARUSH MP DREAMS (OPC) Pvt. Ltd.", M, 18, { width: CW - 130 });

    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor("rgba(255,255,255,0.75)")
      .text("No. 242, Araliganur, Siruguppa - 583121, Karnataka", M, 42)
      .text("GSTIN: 29ABBCA7044H1ZN", M, 55);

    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor(WHITE)
      .text("TAX INVOICE", PAGE_W - 175, 30, { width: 165, align: "center" });
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("rgba(255,255,255,0.8)")
      .text("ORIGINAL FOR RECIPIENT", PAGE_W - 175, 50, { width: 165, align: "center" });

    // ══════════════════════════════════════════════════════════════════════════
    // 2. META STRIP
    // ══════════════════════════════════════════════════════════════════════════
    doc.rect(0, 94, PAGE_W, 46).fill(BG_STRIP);
    doc.rect(0, 139, PAGE_W, 1).fill(BORDER);

    const metaCols = [
      { label: "INVOICE NO",    value: `#${order._id.toString().slice(-10).toUpperCase()}` },
      { label: "DATE",          value: moment(order.createdAt).format("DD MMM YYYY") },
      { label: "ORDER STATUS",  value: order.status.toUpperCase() },
      { label: "PAYMENT",       value: order.paymentStatus.toUpperCase() },
    ];

    const mColW = CW / metaCols.length;
    metaCols.forEach((col, i) => {
      const x = M + i * mColW;
      if (i > 0) doc.rect(x - 1, 100, 1, 32).fill(BORDER);
      doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(col.label, x + 8, 103, { width: mColW - 16 });
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(col.value, x + 8, 116, { width: mColW - 16 });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // 3. BILLED TO + ORDER INFO
    // ══════════════════════════════════════════════════════════════════════════
    const secY = 150;
    const leftW = CW * 0.52;
    const rightX = M + leftW + 20;
    const rightW = CW - leftW - 20;

    // Left card
    doc.roundedRect(M, secY, leftW, 88, 5).fill(BG_LIGHT);
    doc.roundedRect(M, secY, leftW, 88, 5).stroke(BORDER);
    doc.roundedRect(M, secY, 4, 88, 2).fill(G1);

    doc.font("Helvetica-Bold").fontSize(7).fillColor(G1).text("BILLED TO", M + 14, secY + 10);
    doc.font("Helvetica-Bold").fontSize(11.5).fillColor(INK)
      .text(addr.fullName, M + 14, secY + 23, { width: leftW - 20 });
    doc.font("Helvetica").fontSize(8.5).fillColor(INK2)
      .text(addr.street, M + 14, secY + 40, { width: leftW - 20 })
      .text(`${addr.city}, ${addr.state} - ${addr.pincode}`, M + 14, secY + 53, { width: leftW - 20 })
      .text(`Ph: ${addr.phone}`, M + 14, secY + 66, { width: leftW - 20 });

    // Right card
    doc.roundedRect(rightX, secY, rightW, 88, 5).fill(BG_LIGHT);
    doc.roundedRect(rightX, secY, rightW, 88, 5).stroke(BORDER);
    doc.roundedRect(rightX, secY, 4, 88, 2).fill(G1);

    const rMeta = [
      { label: "ORDER ID",     value: order._id.toString() },
      { label: "PAYMENT VIA",  value: (order.paymentInfo?.gateway || "online").toUpperCase() },
      ...(order.usedCouponCode ? [{ label: "COUPON", value: order.usedCouponCode }] : []),
    ];

    let rY = secY + 10;
    rMeta.forEach((m) => {
      doc.font("Helvetica-Bold").fontSize(7).fillColor(G1).text(m.label, rightX + 14, rY, { width: rightW - 20 });
      rY += 12;
      doc.font("Helvetica").fontSize(8.5).fillColor(INK).text(m.value, rightX + 14, rY, { width: rightW - 20 });
      rY += 16;
    });

    // ══════════════════════════════════════════════════════════════════════════
    // 4. ITEMS TABLE
    // ══════════════════════════════════════════════════════════════════════════
    const tY = secY + 100;

    const cols = {
      sno:     { x: M,        w: 24  },
      product: { x: M + 26,   w: 222 },
      qty:     { x: M + 252,  w: 40  },
      price:   { x: M + 296,  w: 80  },
      disc:    { x: M + 380,  w: 68  },
      total:   { x: M + 450,  w: CW - 450 },
    };

    // Header
    doc.rect(M, tY, CW, 26).fill(INK);

    const thY = tY + 7;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(WHITE);
    doc.text("#",           cols.sno.x + 4,   thY, { width: cols.sno.w });
    doc.text("PRODUCT",     cols.product.x,   thY, { width: cols.product.w });
    doc.text("QTY",         cols.qty.x,       thY, { width: cols.qty.w,   align: "center" });
    doc.text("UNIT PRICE",  cols.price.x,     thY, { width: cols.price.w, align: "right" });
    doc.text("DISCOUNT",    cols.disc.x,      thY, { width: cols.disc.w,  align: "right" });
    doc.text("SUBTOTAL",    cols.total.x,     thY, { width: cols.total.w, align: "right" });

    let rowY = tY + 26;

    order.items.forEach((item, i) => {
      const ROW_H = 28;
      doc.rect(M, rowY, CW, ROW_H).fill(i % 2 === 0 ? WHITE : BG_STRIP);
      doc.rect(M, rowY + ROW_H - 0.5, CW, 0.5).fill(BORDER);

      const unitPrice  = item.priceAtPurchase || 0;
      const finalPrice = item.finalPriceAtPurchase || 0;
      const qty        = item.quantity || 1;
      const discAmt    = (unitPrice - finalPrice) * qty;
      const rowTotal   = finalPrice * qty;
      const tRow       = rowY + 8;

      // Row number circle
      doc.circle(cols.sno.x + 10, tRow + 5, 9).fill(i % 2 === 0 ? G3 : BORDER);
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(G2)
        .text(`${i + 1}`, cols.sno.x + 4, tRow + 1, { width: cols.sno.w, align: "center" });

      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK)
        .text(item.productTitle, cols.product.x, tRow, { width: cols.product.w, ellipsis: true });

      doc.font("Helvetica").fontSize(8.5).fillColor(INK2);
      doc.text(qty.toString(), cols.qty.x, tRow, { width: cols.qty.w, align: "center" });
      doc.text(`Rs.${unitPrice.toFixed(2)}`, cols.price.x, tRow, { width: cols.price.w, align: "right" });

      if (discAmt > 0) {
        doc.font("Helvetica-Bold").fillColor(G2)
          .text(`-Rs.${discAmt.toFixed(2)}`, cols.disc.x, tRow, { width: cols.disc.w, align: "right" });
      } else {
        doc.font("Helvetica").fillColor(MUTED)
          .text("—", cols.disc.x, tRow, { width: cols.disc.w, align: "right" });
      }

      doc.font("Helvetica-Bold").fontSize(9).fillColor(INK)
        .text(`Rs.${rowTotal.toFixed(2)}`, cols.total.x, tRow, { width: cols.total.w, align: "right" });

      rowY += ROW_H;
    });

    // Table bottom accent
    doc.rect(M, rowY, CW, 3).fill(G1);

    // ══════════════════════════════════════════════════════════════════════════
    // 5. SUMMARY CARD
    // ══════════════════════════════════════════════════════════════════════════
    const sumStartY = rowY + 16;

    // ORDER-LEVEL fields — source of truth (unchanged)
    const subTotal       = order.totalAmount || 0;
    const gstAmount      = order.totalGstAmount || 0;
    const deliveryCharge = order.deliveryCharge || 0;
    const walletUsed     = order.usedWalletAmount || 0;
    const finalPaid      = order.finalAmountPaid || 0;

    const summaryRows = [
      { label: "Subtotal (excl. GST)",  value: `Rs.${subTotal.toFixed(2)}` },
      { label: "GST",                    value: `Rs.${gstAmount.toFixed(2)}` },
      { label: "Delivery Charges",       value: deliveryCharge > 0 ? `Rs.${deliveryCharge.toFixed(2)}` : "FREE" },
      ...(walletUsed > 0 ? [{ label: "Wallet Discount", value: `-Rs.${walletUsed.toFixed(2)}`, green: true }] : []),
    ];

    const SUM_W  = 248;
    const SUM_X  = PAGE_W - M - SUM_W;
    const ROW_HS = 24;
    const CARD_H = summaryRows.length * ROW_HS + 48;

    // Drop shadow
    doc.roundedRect(SUM_X + 2, sumStartY + 2, SUM_W, CARD_H, 6).fill("#dde3ed");
    // Card body
    doc.roundedRect(SUM_X, sumStartY, SUM_W, CARD_H, 6).fill(WHITE);
    doc.roundedRect(SUM_X, sumStartY, SUM_W, CARD_H, 6).stroke(BORDER);

    let sY = sumStartY + 10;

    summaryRows.forEach((row, i) => {
      if (i > 0) doc.rect(SUM_X + 10, sY - 1, SUM_W - 20, 0.5).fill(BORDER);

      doc.font("Helvetica").fontSize(8.5).fillColor(MUTED)
        .text(row.label, SUM_X + 14, sY + 4, { width: SUM_W * 0.55 });

      doc.font(row.green ? "Helvetica-Bold" : "Helvetica")
        .fontSize(8.5)
        .fillColor(row.green ? G2 : INK)
        .text(row.value, SUM_X + 14 + SUM_W * 0.55, sY + 4, { width: SUM_W * 0.36, align: "right" });

      sY += ROW_HS;
    });

    // Total row — green bottom band of card
    const totalBandY = sumStartY + CARD_H - 40;
    // Flatten top portion of rounded bottom
    doc.rect(SUM_X, totalBandY, SUM_W, 10).fill(WHITE); // cover card border above green
    doc.roundedRect(SUM_X, totalBandY + 8, SUM_W, 32, 6).fill(G1);
    doc.rect(SUM_X, totalBandY + 8, SUM_W, 10).fill(G1); // square top edge of green strip

    doc
      .font("Helvetica-Bold").fontSize(9.5).fillColor(WHITE)
      .text("TOTAL AMOUNT PAID", SUM_X + 14, totalBandY + 14, { width: SUM_W * 0.55 });
    doc
      .font("Helvetica-Bold").fontSize(12).fillColor(WHITE)
      .text(`Rs.${finalPaid.toFixed(2)}`, SUM_X + 14 + SUM_W * 0.55, totalBandY + 12, { width: SUM_W * 0.35, align: "right" });

    // Left savings note
    if (order.usedCouponCode || walletUsed > 0) {
      const noteW  = SUM_X - M - 20;
      const noteH  = (order.usedCouponCode && walletUsed > 0) ? 58 : 40;
      doc.roundedRect(M, sumStartY, noteW, noteH, 5).fill(G3);
      doc.roundedRect(M, sumStartY, 4, noteH, 2).fill(G1);

      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(G2).text("SAVINGS APPLIED", M + 14, sumStartY + 10);
      let nY = sumStartY + 24;
      if (order.usedCouponCode) {
        doc.font("Helvetica").fontSize(8.5).fillColor(INK2).text(`Coupon: ${order.usedCouponCode}`, M + 14, nY);
        nY += 14;
      }
      if (walletUsed > 0) {
        doc.font("Helvetica").fontSize(8.5).fillColor(INK2).text(`Wallet: -Rs.${walletUsed.toFixed(2)}`, M + 14, nY);
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 6. FOOTER
    // ══════════════════════════════════════════════════════════════════════════
    const footerY = PAGE_H - 52;
    doc.rect(0, footerY, PAGE_W, 3).fill(G1);
    doc.rect(0, footerY + 3, PAGE_W, 49).fill(INK);

    doc
      .font("Helvetica").fontSize(7.5).fillColor("rgba(255,255,255,0.5)")
      .text(
        "This is a computer-generated invoice. No signature required.  |  Subject to Siruguppa jurisdiction.",
        M, footerY + 12, { width: CW, align: "center" }
      );
    doc
      .font("Helvetica-Bold").fontSize(8).fillColor("rgba(255,255,255,0.75)")
      .text(
        "AARUSH MP DREAMS (OPC) Pvt. Ltd.  |  GSTIN: 29ABBCA7044H1ZN  |  Thank you for shopping with Dream Mart!",
        M, footerY + 28, { width: CW, align: "center" }
      );
    doc
      .font("Helvetica").fontSize(7).fillColor("rgba(255,255,255,0.3)")
      .text("Page 1 of 1", M, footerY + 40, { width: CW, align: "right" });

    doc.end();

    writeStream.on("finish", () => {
      res.json({
        success: true,
        message: "Invoice generated",
        url: publicUrl,
      });
    });

    writeStream.on("error", (err) => {
      console.error("Write stream error:", err);
      res.status(500).json({
        success: false,
        message: "Failed to write invoice file",
        data: null,
      });
    });

  } catch (err) {
    console.error("Invoice generation error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to generate invoice",
      data: null,
    });
  }
};



exports.createOrderIntentOrangePG = async (req, res) => {
  const user = req.user;
  const { useWallet = false, deliverySlug, idempotencyKey } = req.body;

  if (!deliverySlug) {
    return res.status(200).json({ 
      success: false, 
      message: 'deliverySlug is required' 
    });
  }

  const session = await mongoose.startSession();

  try {
    // ============================================================
    // STEP 0: Idempotency Check
    // ============================================================
    if (idempotencyKey) {
      const existing = await PaymentIntent.findOne({
        userId: user._id,
        idempotencyKey,
        gateway: 'orange_pg',
        status: { $in: ['created', 'authorized'] }
      });

      if (existing) {
        const order = existing.referenceId ? await Order.findById(existing.referenceId) : null;
        return res.status(200).json({
          success: true,
          message: 'Existing Orange PG intent found',
          data: {
            paymentIntentId: existing._id,
            orderId: order?._id || null,
            merchantTxnNo: existing.merchantTxnNo,
            amount: existing.amount,
            currency: existing.currency,
            expiresAt: existing.expiresAt,
            gateway: 'orange_pg'
          }
        });
      }
    }

    // ============================================================
    // STEP 1: Load Cart
    // ============================================================
    session.startTransaction();
    
    const cart = await Cart.findOne({ userId: user._id })
      .populate('items.productId')
      .session(session);
      
    if (!cart || !cart.items || cart.items.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(200).json({ 
        success: false, 
        message: 'Cart is empty' 
      });
    }

    // ============================================================
    // STEP 2: Load User
    // ============================================================
    const userDoc = await User.findById(user._id).session(session);
    if (!userDoc) {
      throw new Error('User not found');
    }

    // ============================================================
    // STEP 3: Address Snapshot
    // ============================================================
    const address = userDoc.eCartProfile?.addresses?.find(
      a => a.slugName === deliverySlug
    );
    
    if (!address) {
      throw new Error('Delivery address not found');
    }

    const deliveryAddress = {
      addressName: address.addressName,
      fullName: address.fullName,
      street: address.street,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      phone: address.phone
    };

    // ============================================================
    // STEP 4: Build Order Items & Validate Stock
    // ============================================================
    let subtotal = 0;
    const orderItems = [];

    for (const item of cart.items) {
      const product = item.productId;
      
      if (!product || !product.isActive || product.stock < item.quantity) {
        throw new Error(
          `Product ${product?.title || 'unknown'} unavailable or insufficient stock`
        );
      }

      const itemTotal = product.finalPrice * item.quantity;
      subtotal += itemTotal;

      orderItems.push({
        productId: product._id,
        sellerId: product.sellerId,
        quantity: item.quantity,
        priceAtPurchase: product.price,
        finalPriceAtPurchase: product.finalPrice,
        productTitle: product.title,
        productThumbnail: product.images?.[0] || '',
        returnPolicyDays: product.returnPolicyDays || 3,
        selectedVariation: item.selectedVariation || []
      });
    }

    const grossPayable = subtotal + (cart.totalGstAmount || 0) + cart.deliveryCharge;

    // ============================================================
    // STEP 5: Wallet Usage (Atomic Deduction)
    // ============================================================
    let usedWalletAmount = 0;
    let remaining = grossPayable;

    if (useWallet && userDoc.wallets?.eCartWallet > 0) {
      usedWalletAmount = Math.min(userDoc.wallets.eCartWallet, grossPayable);

      // Atomic wallet decrement
      const updatedUser = await User.findOneAndUpdate(
        { _id: user._id, 'wallets.eCartWallet': { $gte: usedWalletAmount } },
        { $inc: { 'wallets.eCartWallet': -usedWalletAmount } },
        { new: true, session }
      );

      if (!updatedUser) {
        throw new Error('Insufficient wallet balance (concurrent change)');
      }

      // Create wallet transaction
      await WalletTransaction.create([{
        userId: user._id,
        type: 'spend',
        source: 'purchase',
        fromWallet: 'eCartWallet',
        toWallet: null,
        amount: usedWalletAmount,
        status: 'success',
        triggeredBy: 'user',
        notes: `Wallet used during Orange PG order creation (idempotencyKey: ${idempotencyKey || 'none'})`
      }], { session });

      remaining = +(grossPayable - usedWalletAmount);
    }

    // ============================================================
    // STEP 6: Reserve Stock
    // ============================================================
    for (const item of cart.items) {
      const product = await Product.findById(item.productId._id).session(session);
      
      if (!product || product.stock < item.quantity) {
        throw new Error(
          `Product ${product?.title || 'unknown'} out of stock during reserve`
        );
      }
      
      product.stock -= item.quantity;
      await product.save({ session });
    }

    // ============================================================
    // STEP 7: Create Order & PaymentIntent
    // ============================================================
    const orderDoc = new Order({
      buyerId: user._id,
      items: orderItems,
      deliveryAddress,
      usedWalletAmount,
      totalAmount: subtotal,
      finalAmountPaid: remaining,
      totalGstAmount: cart.totalGstAmount || 0,
      deliveryCharge: cart.deliveryCharge,
      paymentStatus: remaining > 0 ? 'pending' : 'paid',
      status: 'placed',
      paymentInfo: {
        gateway: remaining > 0 ? 'orange_pg' : 'walletOnly',
        paymentId: null
      }
    });

    await orderDoc.save({ session });

    const expiresAt = msFromNow(HOLD_WINDOW_MINUTES);

    // Generate merchantTxnNo (max 20 chars, alphanumeric only)
    // Format: ORD{last 16 chars of orderId}
    const merchantTxnNo = `ORD${orderDoc._id.toString().slice(-16)}`;

    const paymentIntentDoc = new PaymentIntent({
      userId: user._id,
      purpose: 'order',
      referenceId: orderDoc._id,
      amount: remaining,
      currency: 'INR',
      status: remaining > 0 ? 'created' : 'captured',
      expiresAt: remaining > 0 ? expiresAt : new Date(),
      idempotencyKey: idempotencyKey || null,
      gateway: remaining > 0 ? 'orange_pg' : 'walletOnly',
      merchantTxnNo, // Orange PG specific
      meta: {}
    });

    await paymentIntentDoc.save({ session });

    // ============================================================
    // STEP 8: Clear Cart only if wallet-only (remaining === 0)
    // ============================================================
    if (remaining <= 0) {
      await Cart.deleteOne({ userId: user._id }, { session });
    }

    // ============================================================
    // STEP 9: Commit Transaction
    // ============================================================
    await session.commitTransaction();
    session.endSession();

    // ============================================================
    // STEP 10: Response
    // ============================================================
    if (remaining > 0) {
      // Payment required via Orange PG
      return res.status(200).json({
        success: true,
        message: 'Orange PG order intent created',
        data: {
          orderId: orderDoc._id,
          paymentIntentId: paymentIntentDoc._id,
          merchantTxnNo,
          amount: remaining,
          currency: 'INR',
          expiresAt,
          gateway: 'orange_pg'
        }
      });
    } else {
      // Wallet-only payment
      return res.status(200).json({
        success: true,
        message: 'Order placed successfully using wallet only',
        data: {
          orderId: orderDoc._id,
          paymentIntentId: paymentIntentDoc._id,
          totalAmount: subtotal,
          walletUsed: usedWalletAmount,
          paidAmount: 0,
          totalGstAmount: cart.totalGstAmount || 0
        }
      });
    }

  } catch (err) {
    // Abort transaction
    try {
      await session.abortTransaction();
      session.endSession();
    } catch (e) {
      // Ignore abort errors
    }

    console.error('[createOrderIntentOrangePG] error:', err.message);
    
    return res.status(500).json({
      success: false,
      message: `Could not create Orange PG order intent: ${err.message}`
    });
  }
};