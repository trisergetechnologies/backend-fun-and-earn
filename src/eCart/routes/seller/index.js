const express = require('express');
const sellerProductRouter = require('./product.routes.seller');
const sellerUserRouter = require('./user.routes.seller');
const sellerCategoryRouter = require('./category.routes.seller');
const sellerRouter = express.Router();

sellerRouter.use('/product', sellerProductRouter);
sellerRouter.use('/user', sellerUserRouter);
sellerRouter.use('/category', sellerCategoryRouter);

module.exports = sellerRouter;
