const express = require('express');
const { singleImageUpload } = require('../../../middlewares/uploadMiddleware');
const { addProduct } = require('../../controllers/seller/product.controller.seller');
const sellerProductRouter = express.Router();

sellerProductRouter.post('/addproduct', singleImageUpload('image'), addProduct);

module.exports = sellerProductRouter;