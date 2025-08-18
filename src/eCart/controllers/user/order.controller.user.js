const mongoose = require('mongoose');
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
    let grossPayable = subtotal + cart.totalGstAmount;

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
      throw new Error(`Insufficient wallet balance. Required ₹${subtotal}, available ₹${walletBalance}`);
    }

    const totalAmount = subtotal + cart.totalGstAmount;

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

    // ensure invoices folder exists (root level, same as uploads)
    const invoicesDir = path.join(process.cwd(), "invoices");
    if (!fs.existsSync(invoicesDir)) {
      fs.mkdirSync(invoicesDir, { recursive: true });
    }

    // file path
    const filePath = path.join(invoicesDir, `invoice-${order._id}.pdf`);

    // 🔹 Agar purana invoice hai to delete karo
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Old invoice deleted: ${filePath}`);
    }

    const baseUrl = `https://${req.get('host')}`;
    const publicUrl = `${baseUrl}/invoices/invoice-${order._id}.pdf`;

    // Create a PDF document
    const doc = new PDFDocument({ margin: 50 });
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // ---- Company Header ----
    doc.fontSize(20).text("AARUSH MP DREAMS (OPC) Pvt. Ltd. ", { align: "center" });
    doc.fontSize(10).text("No. 242, Araliganur, Siruguppa - 583121", { align: "center" });
    doc.text("GSTIN: 29ABBCA7044H1ZN", { align: "center" });
    doc.moveDown(2);

    // ---- Invoice Meta ----
    doc.fontSize(12).text(`Invoice #: ${order._id}`);
    doc.text(`Invoice Date: ${moment(order.createdAt).format("DD/MM/YYYY")}`);
    doc.moveDown();

    // ---- Buyer Details ----
    doc.fontSize(12).text("Billed To:");
    const addr = order.deliveryAddress;
    doc.text(`${addr.fullName}`);
    doc.text(`${addr.street}, ${addr.city}, ${addr.state} - ${addr.pincode}`);
    doc.text(`Phone: ${addr.phone}`);
    doc.moveDown();

    // ---- Items Table ----
    doc.fontSize(12).text("Order Items:");
    doc.moveDown(0.5);

    // Table headers
    doc.font("Helvetica-Bold");
    doc.text("Product", 50, doc.y, { continued: true });
    doc.text("Qty", 250, doc.y, { continued: true });
    doc.text("Price", 300, doc.y, { continued: true });
    doc.text("GST", 370, doc.y, { continued: true });
    doc.text("Total", 440);
    doc.font("Helvetica");

    order.items.forEach((item) => {
      const lineTotal = item.finalPriceAtPurchase * item.quantity;
      const gstAmount =
        (item.finalPriceAtPurchase - item.priceAtPurchase) * item.quantity;

      doc.text(item.productTitle, 50, doc.y, { continued: true });
      doc.text(item.quantity, 250, doc.y, { continued: true });
      doc.text(`₹${item.priceAtPurchase?.toFixed(2)}`, 300, doc.y, { continued: true });
      doc.text(`₹${gstAmount?.toFixed(2)}`, 370, doc.y, { continued: true });
      doc.text(`₹${lineTotal?.toFixed(2)}`, 440);
    });

    doc.moveDown(2);

    // ---- Summary ----
    doc.font("Helvetica-Bold");
    doc.text(`Amount: ₹${(order.totalAmount - order.totalGstAmount)?.toFixed(2)}`);
    doc.text(`GST: ₹${order.totalGstAmount?.toFixed(2)}`);
    doc.text(`Final Total: ₹${order.finalAmountPaid?.toFixed(2)}`);
    doc.font("Helvetica");
    doc.moveDown();

    // ---- Footer ----
    doc.fontSize(10).text(
      "This is a system generated invoice under GST rules of India.",
      { align: "center" }
    );

    // Finalize PDF
    doc.end();

    // Wait until file is written before sending response
    writeStream.on("finish", () => {
      res.json({
        success: true,
        message: "Invoice generated",
        url: publicUrl,
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

