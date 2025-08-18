const express = require('express');
const { placeOrder, placeOrderWalletOnly, getOrders, cancelOrder, downloadInvoice } = require('../../controllers/user/order.controller.user');
const userOrderRouter = express.Router();

userOrderRouter.post('/placeorder', placeOrder);
userOrderRouter.post('/placeorder/walletonly', placeOrderWalletOnly);
userOrderRouter.get('/getorders', getOrders);
userOrderRouter.patch('/cancelorder', cancelOrder);

userOrderRouter.patch('/get-invoice/:orderId', downloadInvoice);

module.exports = userOrderRouter;