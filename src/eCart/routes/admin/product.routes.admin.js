const express = require('express');
const { flexibleProductImageUpload } = require('../../../middlewares/uploadMiddleware');
const { addProduct, getProducts, updateProduct, deleteProduct } = require('../../controllers/admin/product.controller.admin');
const adminProductRouter = express.Router();

adminProductRouter.post('/addproduct', flexibleProductImageUpload(), addProduct);
adminProductRouter.get('/getproducts', getProducts);
adminProductRouter.get('/getproducts/:id', getProducts);
adminProductRouter.put('/updateproduct/:id', flexibleProductImageUpload(), updateProduct);
adminProductRouter.delete('/deleteproduct/:id', deleteProduct);

module.exports = adminProductRouter;
