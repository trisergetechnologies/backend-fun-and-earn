const express = require('express');
const { placeOrder, placeOrderWalletOnly, getOrders, cancelOrder } = require('../../controllers/user/order.controller.user');
const userOrderRouter = express.Router();

userOrderRouter.post('/placeorder', placeOrder);
userOrderRouter.post('/placeorder/walletonly', placeOrderWalletOnly);
userOrderRouter.get('/getorders', getOrders);
userOrderRouter.patch('/cancelorder', cancelOrder);

module.exports = userOrderRouter;