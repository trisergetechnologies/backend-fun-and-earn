const express = require('express');
const sellerProductRouter = require('./product.routes.seller');
const sellerRouter = express.Router();

sellerRouter.use('/product', sellerProductRouter);

module.exports = sellerRouter;