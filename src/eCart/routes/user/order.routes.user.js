const express = require('express');
const { placeOrder, placeOrderWalletOnly, getOrders, cancelOrder, downloadInvoice, createOrderIntent, createOrderIntentOrangePG } = require('../../controllers/user/order.controller.user');
const userOrderRouter = express.Router();

userOrderRouter.post('/placeorder', placeOrder);
userOrderRouter.post('/placeorder/walletonly', placeOrderWalletOnly);
userOrderRouter.get('/getorders', getOrders);
userOrderRouter.patch('/cancelorder', cancelOrder);
userOrderRouter.post('/createorderintent', createOrderIntent);
userOrderRouter.post('/createorderintent/orangepg', createOrderIntentOrangePG);

userOrderRouter.get('/get-invoice/:orderId', downloadInvoice);

module.exports = userOrderRouter;