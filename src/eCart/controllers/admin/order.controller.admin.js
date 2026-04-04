const mongoose = require('mongoose');
const Order = require('../../models/Order');
const generateCouponForOrder = require('../../helpers/generateCoupon');
const {
  getIstTodayRange,
  getIstMonthRange,
  getIstDayRange,
  istWallFromUtc,
  getIstLastNDaysRange,
  parseIstDateRange,
} = require('../../../utils/istRange');

const OPEN_PIPELINE_STATUSES = ['placed', 'processing', 'shipped'];

function formatUtcIso(d) {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? '' : x.toISOString();
}

function formatIstDisplay(d) {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function escapeCsvCell(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function itemsSummaryForCsv(items) {
  if (!items || !items.length) return '';
  return items
    .map((i) => `${(i.productTitle || '').replace(/;/g, ',')} x${i.quantity || 0}`)
    .join('; ');
}

// 1. Get Orders
exports.getOrders = async (req, res) => {
  try {
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

    const { createdFrom, createdTo } = req.query;
    if (createdFrom || createdTo) {
      try {
        if (createdFrom && createdTo) {
          const { startUtc, endUtc } = parseIstDateRange(createdFrom, createdTo, 366);
          filter.createdAt = { $gte: startUtc, $lt: endUtc };
        } else if (createdFrom) {
          const { startUtc } = getIstDayRange(createdFrom);
          filter.createdAt = { $gte: startUtc };
        } else if (createdTo) {
          const { endUtc } = getIstDayRange(createdTo);
          filter.createdAt = { $lt: endUtc };
        }
      } catch (rangeErr) {
        return res.status(400).json({
          success: false,
          message: rangeErr.message || 'Invalid createdFrom / createdTo (use YYYY-MM-DD, IST)',
          data: null,
        });
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

const paidRevenueSum = {
  $sum: {
    $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$finalAmountPaid', 0],
  },
};

exports.getOrderDashboard = async (req, res) => {
  try {
    const now = new Date();
    const { startUtc: todayStart, endUtc: todayEnd } = getIstTodayRange(now);
    const { year, month0 } = istWallFromUtc(now);
    const { startUtc: monthStart, endUtc: monthEnd } = getIstMonthRange(year, month0 + 1);
    const last30 = getIstLastNDaysRange(30, now);
    const matchToday = { createdAt: { $gte: todayStart, $lt: todayEnd } };
    const matchMonth = { createdAt: { $gte: monthStart, $lt: monthEnd } };
    const matchSeries = { createdAt: { $gte: last30.startUtc, $lt: last30.endUtc } };

    const [
      todayAgg,
      monthAgg,
      openPipelineAgg,
      dailySeriesAgg,
      statusThisMonthAgg,
    ] = await Promise.all([
      Order.aggregate([
        { $match: matchToday },
        {
          $group: {
            _id: null,
            orderCount: { $sum: 1 },
            paidRevenue: paidRevenueSum,
          },
        },
      ]),
      Order.aggregate([
        { $match: matchMonth },
        {
          $group: {
            _id: null,
            orderCount: { $sum: 1 },
            paidRevenue: paidRevenueSum,
          },
        },
      ]),
      Order.aggregate([
        { $match: { status: { $in: OPEN_PIPELINE_STATUSES } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: matchSeries },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
                timezone: 'Asia/Kolkata',
              },
            },
            orderCount: { $sum: 1 },
            paidRevenue: paidRevenueSum,
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: matchMonth },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const t0 = todayAgg[0] || { orderCount: 0, paidRevenue: 0 };
    const m0 = monthAgg[0] || { orderCount: 0, paidRevenue: 0 };
    const dailyMap = Object.fromEntries(
      dailySeriesAgg.map((d) => [d._id, { orderCount: d.orderCount, paidRevenue: d.paidRevenue }])
    );
    const dailySeriesLast30 = last30.labels.map((label) => ({
      date: label,
      orderCount: dailyMap[label]?.orderCount ?? 0,
      paidRevenue: dailyMap[label]?.paidRevenue ?? 0,
    }));

    return res.status(200).json({
      success: true,
      message: 'Order dashboard',
      data: {
        today: {
          orderCount: t0.orderCount,
          paidRevenue: Math.round((t0.paidRevenue + Number.EPSILON) * 100) / 100,
        },
        thisMonth: {
          orderCount: m0.orderCount,
          paidRevenue: Math.round((m0.paidRevenue + Number.EPSILON) * 100) / 100,
        },
        openPipeline: openPipelineAgg.map((r) => ({ status: r._id, count: r.count })),
        dailySeriesLast30,
        statusThisMonth: statusThisMonthAgg.map((r) => ({
          status: r._id,
          count: r.count,
        })),
      },
      meta: {
        timezone: 'Asia/Kolkata',
        metricField: 'createdAt',
        revenueDefinition: 'sum(finalAmountPaid) where paymentStatus=paid',
        openPipelineStatuses: OPEN_PIPELINE_STATUSES,
        statusThisMonthLabel: 'Orders placed this month (IST) by fulfillment status',
      },
    });
  } catch (err) {
    console.error('getOrderDashboard Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

exports.exportOrdersCsv = async (req, res) => {
  try {
    let startUtc;
    let endUtc;
    let label;
    const { year, month, from, to } = req.query;

    if (year != null && month != null && String(year).trim() !== '' && String(month).trim() !== '') {
      const y = parseInt(year, 10);
      const m = parseInt(month, 10);
      if (Number.isNaN(y) || Number.isNaN(m)) {
        return res.status(400).json({ success: false, message: 'Invalid year or month' });
      }
      ({ startUtc, endUtc } = getIstMonthRange(y, m));
      label = `${y}-${String(m).padStart(2, '0')}`;
    } else if (from && to) {
      ({ startUtc, endUtc } = parseIstDateRange(from, to, 366));
      label = `${from}_to_${to}`;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Provide year and month (IST), or from and to (YYYY-MM-DD, IST)',
      });
    }

    const orders = await Order.find({ createdAt: { $gte: startUtc, $lt: endUtc } })
      .populate('buyerId', 'name email phone')
      .sort({ createdAt: 1 })
      .limit(50000)
      .lean();

    const header = [
      'orderId',
      'buyerName',
      'buyerEmail',
      'buyerPhone',
      'status',
      'paymentStatus',
      'finalAmountPaid',
      'totalAmount',
      'usedWalletAmount',
      'deliveryCharge',
      'usedCouponCode',
      'itemsSummary',
      'addressFullName',
      'addressPhone',
      'addressStreet',
      'addressCity',
      'addressState',
      'addressPincode',
      'createdAt_utc_iso',
      'createdAt_ist',
      'updatedAt_utc_iso',
      'updatedAt_ist',
    ];

    const rows = orders.map((o) => {
      const buyer = o.buyerId && typeof o.buyerId === 'object' ? o.buyerId : null;
      const addr = o.deliveryAddress || {};
      return [
        String(o._id),
        buyer?.name || '',
        buyer?.email || '',
        buyer?.phone || '',
        o.status || '',
        o.paymentStatus || '',
        o.finalAmountPaid ?? '',
        o.totalAmount ?? '',
        o.usedWalletAmount ?? '',
        o.deliveryCharge ?? '',
        o.usedCouponCode || '',
        itemsSummaryForCsv(o.items),
        addr.fullName || '',
        addr.phone || '',
        addr.street || '',
        addr.city || '',
        addr.state || '',
        addr.pincode || '',
        formatUtcIso(o.createdAt),
        formatIstDisplay(o.createdAt),
        formatUtcIso(o.updatedAt),
        formatIstDisplay(o.updatedAt),
      ];
    });

    const bom = '\uFEFF';
    const lines = [header.join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))];
    const csv = bom + lines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${label}_IST.csv"`);
    return res.status(200).send(csv);
  } catch (err) {
    if (
      err.message &&
      (err.message.includes('YYYY-MM-DD') ||
        err.message.includes('at most') ||
        err.message.includes('must be on or after') ||
        err.message.includes('month must be'))
    ) {
      return res.status(400).json({ success: false, message: err.message });
    }
    console.error('exportOrdersCsv Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
    });
  }
};