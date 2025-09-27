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
    if (buyerId) {
      filter.buyerId = buyerId;
    }
    if (sellerId) {
      filter['items.sellerId'] = sellerId;
    }

    // Get all orders with filters
    const orders = await Order.find(filter)
      .populate('buyerId', 'name email')
      .populate('items.productId', 'title')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: status ? `Orders filtered by status: ${status}` : 'All orders fetched',
      data: orders
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