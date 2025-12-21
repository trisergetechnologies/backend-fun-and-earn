const Express = require('express');
const userProductRouter = require('./product.routes.user');
const userAddressRouter = require('./address.routes.user');
const userCartRouter = require('./cart.routes.user');
const userOrderRouter = require('./order.routes.user');
const Category = require('../../models/Category');
const userWalletRouter = require('./wallet.routes.user');
const userGeneralRouter = require('./general.routes.user');
const userPaymentRouter = require('./payment.routes.user');
const orangePGRouter = require('./orangepg.routes.user');

const eCartUserRouter = Express.Router();

eCartUserRouter.use('/address', userAddressRouter);
eCartUserRouter.use('/product', userProductRouter);
eCartUserRouter.use('/cart', userCartRouter);
eCartUserRouter.use('/order', userOrderRouter);
eCartUserRouter.use('/wallet', userWalletRouter);
eCartUserRouter.use('/general', userGeneralRouter);
eCartUserRouter.use('/payment', userPaymentRouter);
eCartUserRouter.use('/payment', orangePGRouter);


const getCategories = async (req, res)=>{
    try {
    const categories = await Category.find({ isActive: true });

    res.status(200).json({
      success: true,
      count: categories.length,
      data: categories,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories',
      error: error.message,
    });
  }
}

eCartUserRouter.get('/categories', getCategories);


module.exports = eCartUserRouter