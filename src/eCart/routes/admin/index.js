const express = require('express');
const adminRouter = express.Router();

// Router Imports
const adminProductRouter = require('./product.routes.admin');
const adminCategoryRouter = require('./category.routes.admin');
const adminOrderRouter = require('./order.routes.admin');
const adminSellerRouter = require('./seller.routes.admin');
const adminUserRouter = require('./user.routes.admin');
const adminWalletRouter = require('./wallet.routes.admin');

// Routes Admin
adminRouter.use('/category', adminCategoryRouter);
adminRouter.use('/product', adminProductRouter);
adminRouter.use('/order', adminOrderRouter);
adminRouter.use('/seller', adminSellerRouter);
adminRouter.use('/user', adminUserRouter);
adminRouter.use('/wallet', adminWalletRouter);

module.exports = adminRouter;