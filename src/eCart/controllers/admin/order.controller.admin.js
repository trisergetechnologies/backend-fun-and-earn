const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
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

function itemsSummaryForCsv(items) {
  if (!items || !items.length) return '';
  return items
    .map((i) => `${(i.productTitle || '').replace(/;/g, ',')} x${i.quantity || 0}`)
    .join('; ');
}

/** Short period slug + wall-clock stamp; safe for Content-Disposition filenames. */
function buildOrderReportFilename(periodPart) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const safe = String(periodPart).replace(/[^0-9A-Za-z._-]/g, '');
  return `order-report-${safe}_${stamp}.xlsx`;
}

function lastTrackingSummary(trackingUpdates) {
  if (!Array.isArray(trackingUpdates) || !trackingUpdates.length) return '';
  const last = trackingUpdates[trackingUpdates.length - 1];
  const status = last.status || '';
  const note = (last.note && String(last.note).trim()) || '';
  const when = last.updatedAt ? formatIstDisplay(last.updatedAt) : '';
  let s = status;
  if (note) s += (s ? ' — ' : '') + note;
  if (when) s += (s ? ' • ' : '') + when;
  return s;
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

    const [todayAgg, monthAgg, dailySeriesAgg] = await Promise.all([
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
        dailySeriesLast30,
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

exports.exportOrdersExcel = async (req, res) => {
  try {
    let startUtc;
    let endUtc;
    let label;
    let periodPart;
    const { year, month, from, to } = req.query;

    if (year != null && month != null && String(year).trim() !== '' && String(month).trim() !== '') {
      const y = parseInt(year, 10);
      const m = parseInt(month, 10);
      if (Number.isNaN(y) || Number.isNaN(m)) {
        return res.status(400).json({ success: false, message: 'Invalid year or month' });
      }
      ({ startUtc, endUtc } = getIstMonthRange(y, m));
      label = `${y}-${String(m).padStart(2, '0')}`;
      periodPart = label;
    } else if (from && to) {
      ({ startUtc, endUtc } = parseIstDateRange(from, to, 366));
      label = `${from} → ${to}`;
      periodPart = `${String(from).replace(/-/g, '')}-${String(to).replace(/-/g, '')}`;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Provide year and month, or from and to (YYYY-MM-DD)',
      });
    }

    const orders = await Order.find({
      createdAt: { $gte: startUtc, $lt: endUtc },
      paymentStatus: 'paid',
    })
      .populate('buyerId', 'name email phone')
      .sort({ createdAt: 1 })
      .limit(50000)
      .lean();

    const headerLabels = [
      'Order ID',
      'Buyer name',
      'Email',
      'Phone',
      'Payment status',
      'Delivery status',
      'Refund status',
      'Cancel requested',
      'Return requested',
      'Return status',
      'Payment gateway',
      'Payment / txn ID',
      'Final amount paid (₹)',
      'Total amount (₹)',
      'Wallet used (₹)',
      'Delivery charge (₹)',
      'Coupon',
      'Items',
      'Ship to name',
      'Ship phone',
      'Address line',
      'City',
      'State',
      'PIN',
      'Latest tracking update',
      'Placed at (UTC)',
      'Placed at (India)',
      'Updated at (UTC)',
      'Updated at (India)',
    ];

    const colWidths = [
      26, 20, 28, 14, 14, 16, 14, 12, 12, 14, 14, 22, 14, 14, 12, 12, 12, 40, 18, 14, 28, 14, 12, 8, 36,
      22, 22, 22, 22,
    ];

    const colCount = headerLabels.length;
    const thin = { style: 'thin', color: { argb: 'FF312E81' } };
    const thinGray = { style: 'thin', color: { argb: 'FFE5E7EB' } };
    const headerBottom = { style: 'medium', color: { argb: 'FF312E81' } };

    function colLetter(index1Based) {
      let n = index1Based;
      let s = '';
      while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
      }
      return s;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Fun-Earn Admin';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Orders', {
      properties: { tabColor: { argb: 'FF4F46E5' } },
      views: [{ state: 'frozen', ySplit: 2 }],
    });

    sheet.mergeCells(1, 1, 1, colCount);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = `Order report — ${label} — ${orders.length} paid order${orders.length === 1 ? '' : 's'}`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF312E81' },
    };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    sheet.getRow(1).height = 40;

    const headerRow = sheet.addRow(headerLabels);
    headerRow.height = 26;
    headerRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF6366F1' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: thin,
        left: thin,
        bottom: headerBottom,
        right: thin,
      };
      const w = colWidths[colNumber - 1];
      if (w) sheet.getColumn(colNumber).width = w;
    });

    sheet.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2, column: colCount },
    };

    const moneyNumFmt = '#,##0.00';
    let rowNum = 3;
    for (const o of orders) {
      const buyer = o.buyerId && typeof o.buyerId === 'object' ? o.buyerId : null;
      const addr = o.deliveryAddress || {};
      const pay = o.paymentInfo || {};

      const values = [
        String(o._id),
        buyer?.name || '',
        buyer?.email || '',
        buyer?.phone || '',
        o.paymentStatus || 'paid',
        o.status || '',
        o.refundStatus || '',
        o.cancelRequested ? 'Yes' : 'No',
        o.returnRequested ? 'Yes' : 'No',
        o.returnStatus || '',
        pay.gateway || '',
        pay.paymentId || '',
        Number(o.finalAmountPaid) || 0,
        Number(o.totalAmount) || 0,
        Number(o.usedWalletAmount) || 0,
        Number(o.deliveryCharge) || 0,
        o.usedCouponCode || '',
        itemsSummaryForCsv(o.items),
        addr.fullName || '',
        addr.phone || '',
        addr.street || '',
        addr.city || '',
        addr.state || '',
        addr.pincode || '',
        lastTrackingSummary(o.trackingUpdates),
        formatUtcIso(o.createdAt),
        formatIstDisplay(o.createdAt),
        formatUtcIso(o.updatedAt),
        formatIstDisplay(o.updatedAt),
      ];

      const row = sheet.addRow(values);
      const stripe = rowNum % 2 === 0;
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.border = {
          top: thinGray,
          left: thinGray,
          bottom: thinGray,
          right: thinGray,
        };
        if (colNumber === 1) {
          cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF374151' } };
        } else {
          cell.font = { name: 'Calibri', size: 10 };
        }
        if (stripe) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' },
          };
        }
        if (colNumber >= 13 && colNumber <= 16) {
          cell.numFmt = moneyNumFmt;
        }
      });
      rowNum += 1;
    }

    if (orders.length > 0) {
      const firstDataRow = 3;
      const lastDataRow = 2 + orders.length;
      const totalRow = sheet.addRow([]);
      totalRow.height = 22;
      const labelCell = totalRow.getCell(11);
      labelCell.value = 'Totals';
      labelCell.font = { bold: true, size: 11, color: { argb: 'FF1E1B4B' } };
      labelCell.alignment = { horizontal: 'right' };
      labelCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEEF2FF' },
      };
      for (let c = 13; c <= 16; c += 1) {
        const letter = colLetter(c);
        const cell = totalRow.getCell(c);
        cell.value = {
          formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`,
        };
        cell.numFmt = moneyNumFmt;
        cell.font = { bold: true, size: 11, color: { argb: 'FF1E1B4B' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E7FF' },
        };
        cell.border = {
          top: { style: 'medium', color: { argb: 'FF6366F1' } },
          bottom: thinGray,
          left: thinGray,
          right: thinGray,
        };
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = buildOrderReportFilename(periodPart);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    return res.status(200).send(Buffer.from(buffer));
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
    console.error('exportOrdersExcel Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
    });
  }
};