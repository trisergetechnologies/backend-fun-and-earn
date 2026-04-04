const express = require('express');
const {
  getOrders,
  updateOrderStatus,
  getOrderDashboard,
  exportOrdersExcel,
} = require('../../controllers/admin/order.controller.admin');

const adminOrderRouter = express.Router();

adminOrderRouter.get('/getorders', getOrders);
adminOrderRouter.get('/orders', getOrders);
adminOrderRouter.get('/order/dashboard', getOrderDashboard);
adminOrderRouter.get('/order/export.xlsx', exportOrdersExcel);
adminOrderRouter.get('/order/:id', getOrders);

adminOrderRouter.put('/order/updatestatus/:id', updateOrderStatus);


module.exports = adminOrderRouter;