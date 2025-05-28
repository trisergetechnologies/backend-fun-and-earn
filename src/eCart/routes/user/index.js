const Express = require('express');
const userProductRouter = require('./product.routes.user');
const userAddressRouter = require('./address.routes.user');
const userCartRouter = require('./cart.routes.user');
const userOrderRouter = require('./order.routes.user');

const eCartUserRouter = Express.Router();

eCartUserRouter.use('/address', userAddressRouter);
eCartUserRouter.use('/product', userProductRouter);
eCartUserRouter.use('/cart', userCartRouter);
eCartUserRouter.use('/order', userOrderRouter);


module.exports = eCartUserRouter