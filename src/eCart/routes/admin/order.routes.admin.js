const express = require('express');
const {
  getOrders,
  updateOrderStatus,
  getOrderDashboard,
  exportOrdersCsv,
} = require('../../controllers/admin/order.controller.admin');

const adminOrderRouter = express.Router();

adminOrderRouter.get('/getorders', getOrders);
adminOrderRouter.get('/orders', getOrders);
adminOrderRouter.get('/order/dashboard', getOrderDashboard);
adminOrderRouter.get('/order/export.csv', exportOrdersCsv);
adminOrderRouter.get('/order/:id', getOrders);

adminOrderRouter.put('/order/updatestatus/:id', updateOrderStatus);


module.exports = adminOrderRouter;