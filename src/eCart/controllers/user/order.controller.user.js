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
        returnPolicyDays: product.returnPolicyDays || 3
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
        returnPolicyDays: product.returnPolicyDays || 3
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

    // Step 8: Clear cart (we preserve order but empty cart)
    await Cart.deleteOne({ userId: user._id }, { session });

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
        returnPolicyDays: product.returnPolicyDays || 3
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

    // Delete old invoice if exists
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const baseUrl = `https://${req.get("host")}`;
    const publicUrl = `${baseUrl}/invoices/invoice-${order._id}.pdf`;

    // ─── PDF Setup ───────────────────────────────────────────────────────────
    const doc = new PDFDocument({ margin: 0, size: "A4" });
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    const PAGE_W = doc.page.width;   // 595.28
    const PAGE_H = doc.page.height;  // 841.89
    const MARGIN = 45;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    // ─── Color Palette ────────────────────────────────────────────────────────
    const GREEN       = "#10b981";
    const DARK        = "#111827";
    const MUTED       = "#6b7280";
    const LIGHT_BG    = "#f9fafb";
    const BORDER      = "#e5e7eb";
    const WHITE       = "#ffffff";
    const GREEN_DARK  = "#059669";

    // ══════════════════════════════════════════════════════════════════════════
    //  HEADER BAND
    // ══════════════════════════════════════════════════════════════════════════
    doc.rect(0, 0, PAGE_W, 110).fill(GREEN);

    // Company name
    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor(WHITE)
      .text("AARUSH MP DREAMS (OPC) Pvt. Ltd.", MARGIN, 22, { width: CONTENT_W });

    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor("rgba(255,255,255,0.85)")
      .text("No. 242, Araliganur, Siruguppa - 583121, Karnataka", MARGIN, 47)
      .text("GSTIN: 29ABBCA7044H1ZN", MARGIN, 61);

    // TAX INVOICE badge (right side of header)
    const badgeW = 120, badgeH = 30;
    const badgeX = PAGE_W - MARGIN - badgeW;
    const badgeY = 38;
    doc
      .roundedRect(badgeX, badgeY, badgeW, badgeH, 4)
      .fill("rgba(255,255,255,0.18)");
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(WHITE)
      .text("TAX INVOICE", badgeX, badgeY + 9, { width: badgeW, align: "center" });

    // ══════════════════════════════════════════════════════════════════════════
    //  META INFO ROW  (Invoice # | Date | Status)
    // ══════════════════════════════════════════════════════════════════════════
    const metaY = 125;
    doc.rect(0, 110, PAGE_W, 55).fill(LIGHT_BG);
    doc.rect(0, 164, PAGE_W, 1).fill(BORDER);

    const metaCols = [
      { label: "Invoice No.", value: `#${order._id.toString().slice(-10).toUpperCase()}` },
      { label: "Invoice Date",  value: moment(order.createdAt).format("DD MMM YYYY") },
      { label: "Order Status",  value: order.status.toUpperCase() },
      { label: "Payment",       value: order.paymentStatus.toUpperCase() },
    ];

    const colW = CONTENT_W / metaCols.length;
    metaCols.forEach((col, i) => {
      const x = MARGIN + i * colW;
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(col.label, x, metaY, { width: colW - 10 });
      doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text(col.value, x, metaY + 14, { width: colW - 10 });
    });

    // ══════════════════════════════════════════════════════════════════════════
    //  BILLED TO / ORDER ID SECTION
    // ══════════════════════════════════════════════════════════════════════════
    const billedY = 182;

    doc.font("Helvetica-Bold").fontSize(8).fillColor(GREEN).text("BILLED TO", MARGIN, billedY);
    doc.rect(MARGIN, billedY + 12, CONTENT_W * 0.55, 0.5).fill(BORDER);

    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(DARK)
      .text(addr.fullName, MARGIN, billedY + 20);

    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(MUTED)
      .text(`${addr.street}`, MARGIN, billedY + 36)
      .text(`${addr.city}, ${addr.state} - ${addr.pincode}`, MARGIN, billedY + 50)
      .text(`Phone: ${addr.phone}`, MARGIN, billedY + 64);

    // Full Order ID on right
    const oidX = MARGIN + CONTENT_W * 0.6;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(GREEN).text("FULL ORDER ID", oidX, billedY);
    doc.font("Helvetica").fontSize(8.5).fillColor(DARK).text(order._id.toString(), oidX, billedY + 20, { width: CONTENT_W * 0.4 });

    // Payment method
    doc.font("Helvetica-Bold").fontSize(8).fillColor(GREEN).text("PAYMENT METHOD", oidX, billedY + 40);
    doc.font("Helvetica").fontSize(9).fillColor(DARK).text(
      (order.paymentInfo?.gateway || "online").toUpperCase(),
      oidX, billedY + 54
    );

    if (order.usedCouponCode) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor(GREEN).text("COUPON APPLIED", oidX, billedY + 70);
      doc.font("Helvetica").fontSize(9).fillColor(DARK).text(order.usedCouponCode, oidX, billedY + 84);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  ITEMS TABLE
    // ══════════════════════════════════════════════════════════════════════════
    const tableY = billedY + 105;

    // Table Header
    doc.rect(MARGIN, tableY, CONTENT_W, 28).fill(GREEN);

    const cols = {
      product: { x: MARGIN + 8,  w: 240 },
      qty:     { x: MARGIN + 255, w: 50  },
      price:   { x: MARGIN + 315, w: 80  },
      disc:    { x: MARGIN + 400, w: 65  },
      total:   { x: MARGIN + 465, w: 80  },
    };

    const thY = tableY + 8;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(WHITE);
    doc.text("PRODUCT",          cols.product.x, thY, { width: cols.product.w });
    doc.text("QTY",              cols.qty.x,     thY, { width: cols.qty.w,   align: "center" });
    doc.text("UNIT PRICE",       cols.price.x,   thY, { width: cols.price.w, align: "right"  });
    doc.text("DISCOUNT",         cols.disc.x,    thY, { width: cols.disc.w,  align: "right"  });
    doc.text("SUBTOTAL",         cols.total.x,   thY, { width: cols.total.w, align: "right"  });

    let rowY = tableY + 28;
    doc.font("Helvetica").fontSize(9.5).fillColor(DARK);

    order.items.forEach((item, i) => {
      const rowH = 30;
      // Alternating row background
      if (i % 2 === 0) {
        doc.rect(MARGIN, rowY, CONTENT_W, rowH).fill(WHITE);
      } else {
        doc.rect(MARGIN, rowY, CONTENT_W, rowH).fill(LIGHT_BG);
      }

      // Row border bottom
      doc.rect(MARGIN, rowY + rowH - 0.5, CONTENT_W, 0.5).fill(BORDER);

      const unitPrice    = item.priceAtPurchase || 0;
      const finalPrice   = item.finalPriceAtPurchase || 0;  // price after discount
      const qty          = item.quantity || 1;
      const discPerUnit  = unitPrice - finalPrice;
      const rowTotal     = finalPrice * qty;

      const textY = rowY + 9;
      doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK)
        .text(item.productTitle, cols.product.x, textY, { width: cols.product.w, ellipsis: true });

      doc.font("Helvetica").fontSize(9).fillColor(DARK);
      doc.text(qty.toString(),               cols.qty.x,   textY, { width: cols.qty.w,   align: "center" });
      doc.text(`₹${unitPrice.toFixed(2)}`,   cols.price.x, textY, { width: cols.price.w, align: "right"  });
      doc.text(
        discPerUnit > 0 ? `-₹${(discPerUnit * qty).toFixed(2)}` : "—",
        cols.disc.x, textY, { width: cols.disc.w, align: "right" }
      );
      doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK)
        .text(`₹${rowTotal.toFixed(2)}`, cols.total.x, textY, { width: cols.total.w, align: "right" });

      rowY += rowH;
    });

    // Table bottom border
    doc.rect(MARGIN, rowY, CONTENT_W, 1.5).fill(GREEN);

    // ══════════════════════════════════════════════════════════════════════════
    //  SUMMARY SECTION
    // ══════════════════════════════════════════════════════════════════════════
    const summaryStartY = rowY + 20;

    // Use ORDER-LEVEL fields directly (source of truth)
    const subTotal      = order.totalAmount || 0;              // pre-gst, pre-delivery base
    const gstAmount     = order.totalGstAmount || 0;
    const deliveryCharge = order.deliveryCharge || 0;
    const walletUsed    = order.usedWalletAmount || 0;
    const finalPaid     = order.finalAmountPaid || 0;

    // Summary box (right-aligned)
    const summaryW = 260;
    const summaryX = PAGE_W - MARGIN - summaryW;

    const summaryRows = [
      { label: "Subtotal (excl. GST)",  value: `₹${subTotal.toFixed(2)}`,       bold: false },
      { label: "GST",                    value: `₹${gstAmount.toFixed(2)}`,       bold: false },
      { label: "Delivery Charges",       value: deliveryCharge > 0 ? `₹${deliveryCharge.toFixed(2)}` : "FREE", bold: false },
    ];

    if (walletUsed > 0) {
      summaryRows.push({ label: "Wallet Discount", value: `-₹${walletUsed.toFixed(2)}`, bold: false, color: GREEN_DARK });
    }

    summaryRows.push({ label: "TOTAL AMOUNT PAID", value: `₹${finalPaid.toFixed(2)}`, bold: true, total: true });

    let sY = summaryStartY;

    // Summary card background
    const totalSummaryH = summaryRows.length * 28 + 16;
    doc.roundedRect(summaryX - 12, sY - 8, summaryW + 12, totalSummaryH, 6).fill(LIGHT_BG);
    doc.roundedRect(summaryX - 12, sY - 8, summaryW + 12, totalSummaryH, 6).stroke(BORDER);

    summaryRows.forEach((row, i) => {
      if (row.total) {
        // Highlight row
        doc.rect(summaryX - 12, sY - 4, summaryW + 12, 28).fill(GREEN);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(WHITE)
          .text(row.label, summaryX, sY + 4, { width: (summaryW - 20) * 0.6 })
          .text(row.value, summaryX + (summaryW - 20) * 0.6, sY + 4, { width: (summaryW - 20) * 0.4, align: "right" });
      } else {
        if (i < summaryRows.length - 2) {
          doc.rect(summaryX - 12, sY + 22, summaryW + 12, 0.5).fill(BORDER);
        }
        doc.font("Helvetica").fontSize(9.5).fillColor(MUTED)
          .text(row.label, summaryX, sY + 5, { width: (summaryW - 20) * 0.6 });
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor(row.color || DARK)
          .text(row.value, summaryX + (summaryW - 20) * 0.6, sY + 5, { width: (summaryW - 20) * 0.4 + 8, align: "right" });
      }
      sY += 28;
    });

    // Note on left (same level as summary)
    if (order.usedCouponCode || walletUsed > 0) {
      doc.font("Helvetica").fontSize(8.5).fillColor(MUTED)
        .text("Savings applied:", summaryX - summaryW - 20, summaryStartY + 5, { width: summaryW - 30 });
      if (order.usedCouponCode) {
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(GREEN_DARK)
          .text(`Coupon "${order.usedCouponCode}" used`, summaryX - summaryW - 20, summaryStartY + 20, { width: summaryW - 30 });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  FOOTER
    // ══════════════════════════════════════════════════════════════════════════
    const footerY = PAGE_H - 60;
    doc.rect(0, footerY, PAGE_W, 1).fill(BORDER);

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        "This is a computer-generated invoice. No signature required. | Subject to Siruguppa jurisdiction.",
        MARGIN, footerY + 12, { width: CONTENT_W, align: "center" }
      )
      .text(
        "AARUSH MP DREAMS (OPC) Pvt. Ltd. | GSTIN: 29ABBCA7044H1ZN | Thank you for shopping with Dream Mart!",
        MARGIN, footerY + 28, { width: CONTENT_W, align: "center" }
      );

    // Page number
    doc.font("Helvetica").fontSize(8).fillColor(MUTED)
      .text("Page 1 of 1", MARGIN, footerY + 44, { width: CONTENT_W, align: "right" });

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
        returnPolicyDays: product.returnPolicyDays || 3
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
    // STEP 8: Clear Cart
    // ============================================================
    await Cart.deleteOne({ userId: user._id }, { session });

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