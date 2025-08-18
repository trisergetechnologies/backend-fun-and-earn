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

    // Create PDF document
    const doc = new PDFDocument({ margin: 40 });
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // ---------- HEADER ----------
    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .fillColor("#2C3E50")
      .text("AARUSH MP DREAMS (OPC) Pvt. Ltd.", { align: "center" });

    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#555")
      .text("No. 242, Araliganur, Siruguppa - 583121", { align: "center" })
      .moveDown(0.3)
      .text("GSTIN: 29ABBCA7044H1ZN", { align: "center" });

    doc.moveDown(2);

    // ---------- INVOICE META ----------
    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Invoice Details", { underline: true });

    doc.moveDown(0.5);
    doc
      .font("Helvetica")
      .text(`Invoice #: ${order._id}`)
      .text(`Invoice Date: ${moment(order.createdAt).format("DD/MM/YYYY")}`);

    doc.moveDown(1.5);

    // ---------- BILLING INFO ----------
    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("Billed To", { underline: true });

    doc.moveDown(0.5);
    doc
      .font("Helvetica")
      .text(`${addr.fullName}`)
      .text(`${addr.street}, ${addr.city}, ${addr.state} - ${addr.pincode}`)
      .text(`📞 ${addr.phone}`);

    doc.moveDown(2);

    // ---------- ORDER ITEMS TABLE ----------
    const tableTop = doc.y;
    const startX = 50;
    const colWidths = {
      product: 180,
      qty: 60,
      price: 80,
      gst: 80,
      total: 100,
    };

    // Table Header Background
    doc
      .rect(startX - 5, tableTop - 5, 480, 25)
      .fill("#f2f2f2")
      .stroke();

    // Headers
    doc
      .fillColor("#000")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Product", startX, tableTop, { width: colWidths.product })
      .text("Qty", startX + colWidths.product, tableTop, {
        width: colWidths.qty,
        align: "center",
      })
      .text("Price (₹)", startX + colWidths.product + colWidths.qty, tableTop, {
        width: colWidths.price,
        align: "right",
      })
      .text("GST (₹)", startX + colWidths.product + colWidths.qty + colWidths.price, tableTop, {
        width: colWidths.gst,
        align: "right",
      })
      .text("Total (₹)", startX + colWidths.product + colWidths.qty + colWidths.price + colWidths.gst, tableTop, {
        width: colWidths.total,
        align: "right",
      });

    doc.moveDown(1);
    let yPos = doc.y;

    // Rows
    doc.font("Helvetica").fontSize(11);
    order.items.forEach((item, i) => {
      const lineTotal = item.finalPriceAtPurchase * item.quantity;
      const gstAmount =
        (item.finalPriceAtPurchase - item.priceAtPurchase) * item.quantity;

      const rowHeight = 20;
      const rowY = yPos + i * rowHeight;

      // Alternate row shading
      if (i % 2 === 0) {
        doc.rect(startX - 5, rowY - 5, 480, rowHeight).fill("#fafafa").stroke();
        doc.fillColor("#000");
      }

      doc.text(item.productTitle, startX, rowY, { width: colWidths.product });
      doc.text(item.quantity.toString(), startX + colWidths.product, rowY, {
        width: colWidths.qty,
        align: "center",
      });
      doc.text(`₹${item.priceAtPurchase?.toFixed(2)}`, startX + colWidths.product + colWidths.qty, rowY, {
        width: colWidths.price,
        align: "right",
      });
      doc.text(`₹${gstAmount?.toFixed(2)}`, startX + colWidths.product + colWidths.qty + colWidths.price, rowY, {
        width: colWidths.gst,
        align: "right",
      });
      doc.text(`₹${lineTotal?.toFixed(2)}`, startX + colWidths.product + colWidths.qty + colWidths.price + colWidths.gst, rowY, {
        width: colWidths.total,
        align: "right",
      });

      yPos = rowY;
    });

    doc.moveDown(3);

    // ---------- SUMMARY ----------
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#000")
      .text("Summary", { underline: true });

    doc.moveDown(0.5);
    doc
      .font("Helvetica")
      .fontSize(11)
      .text(`Amount: ₹${(order.totalAmount - order.totalGstAmount)?.toFixed(2)}`)
      .text(`GST: ₹${order.totalGstAmount?.toFixed(2)}`)
      .text(`Final Total: ₹${order.finalAmountPaid?.toFixed(2)}`, {
        underline: true,
      });

    doc.moveDown(2);

    // ---------- FOOTER ----------
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(
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

