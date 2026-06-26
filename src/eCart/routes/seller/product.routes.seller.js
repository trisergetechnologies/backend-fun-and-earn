const express = require('express');
const { flexibleProductImageUpload } = require('../../../middlewares/uploadMiddleware');
const {
  addProduct,
  getProducts,
  updateProduct,
  deleteProduct,
} = require('../../controllers/seller/product.controller.seller');

const sellerProductRouter = express.Router();

sellerProductRouter.post('/addproduct', flexibleProductImageUpload(), addProduct);
sellerProductRouter.get('/getproducts', getProducts);
sellerProductRouter.get('/getproducts/:id', getProducts);
sellerProductRouter.put('/updateproduct/:id', flexibleProductImageUpload(), updateProduct);
sellerProductRouter.delete('/deleteproduct/:id', deleteProduct);

module.exports = sellerProductRouter;
