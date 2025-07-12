const express = require('express');
const { getOrders, updateOrderStatus } = require('../../controllers/admin/order.controller.admin');

const adminOrderRouter = express.Router();

adminOrderRouter.get('/getorders', getOrders);
adminOrderRouter.get('/orders/:id', getOrders);

adminOrderRouter.put('/order/:id/status', updateOrderStatus);


module.exports = adminOrderRouter;