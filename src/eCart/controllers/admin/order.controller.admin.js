const mongoose = require('mongoose');
const Order = require('../../models/Order');
const Product = require('../../models/Product');
const User = require('../../../models/User');
const generateCouponForOrder = require('../../helpers/generateCoupon');

// 1. Get Orders
exports.getOrders = async (req, res) => {
  try {
    const admin = req.user;
    const { id } = req.params;
    const { status, buyerId, sellerId } = req.query;

    // Build filter
    const filter = {};

    // Get single order by ID
    if (id) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(200).json({
          success: false,
          message: 'Invalid order ID',
          data: null
        });
      }

      const order = await Order.findById(id)
        .populate('buyerId', 'name email phone')
        .populate('items.productId', 'title')
        .populate('items.sellerId', 'name');

      if (!order) {
        return res.status(200).json({
          success: false,
          message: 'Order not found',
          data: null
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Order details fetched',
        data: order
      });
    }

    // Apply filters if provided
    if (status) {
      filter.status = status;
    }
    if (req.query.paymentStatus) {
      filter.paymentStatus = req.query.paymentStatus;
    }
    if (buyerId) {
      filter.buyerId = buyerId;
    }
    if (sellerId) {
      filter['items.sellerId'] = sellerId;
    }
    // Search by order ID (only when valid ObjectId)
    if (req.query.search && typeof req.query.search === 'string' && req.query.search.trim()) {
      const id = req.query.search.trim();
      if (mongoose.Types.ObjectId.isValid(id)) {
        filter._id = id;
      }
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;
    const sortBy = req.query.sortBy || 'newest';
    let sortOpt = { createdAt: -1 };
    if (sortBy === 'oldest') sortOpt = { createdAt: 1 };
    else if (sortBy === 'amountHigh') sortOpt = { finalAmountPaid: -1 };
    else if (sortBy === 'amountLow') sortOpt = { finalAmountPaid: 1 };

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate('buyerId', 'name email')
        .populate('items.productId', 'title')
        .sort(sortOpt)
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      message: status ? `Orders filtered by status: ${status}` : 'All orders fetched',
      data: orders,
      pagination: { page, limit, total, totalPages }
    });

  } catch (err) {
    console.error('Get Orders Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};

// 2. Update Order Status
exports.updateOrderStatus = async (req, res) => {
  try {
    const admin = req.user;
    const { id } = req.params;
    const { status, note } = req.body;

    // Validate status
    const validStatuses = ['placed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
    if (!validStatuses.includes(status)) {
      return res.status(200).json({
        success: false,
        message: 'Invalid status value',
        data: null
      });
    }

    // Find and update order
    const order = await Order.findById(id);
    if (!order) {
      return res.status(200).json({
        success: false,
        message: 'Order not found',
        data: null
      });
    }

    // Add to tracking updates
    order.trackingUpdates.push({
      status,
      note: note || ''
    });

    // Update order status
    order.status = status;

    // Handle special status cases
    if (status === 'cancelled') {
      order.refundStatus = 'pending';
    }
    if (status === 'returned') {
      order.returnStatus = 'completed';
    }

    await order.save();

    if(order.status === 'delivered'){
      await generateCouponForOrder(order);
    }

    return res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      data: {
        _id: order._id,
        status: order.status,
        trackingUpdates: order.trackingUpdates
      }
    });

  } catch (err) {
    console.error('Update Order Status Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};