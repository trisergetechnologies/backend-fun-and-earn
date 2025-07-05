const express = require('express');
const { getProducts, searchProducts } = require('../../controllers/user/product.controller.user');
const userProductRouter = express.Router();

userProductRouter.get('/products', getProducts);
userProductRouter.get('/products/:id', getProducts);
userProductRouter.get('/products/slug/:slug', getProducts);
userProductRouter.get('/products/search', searchProducts);


module.exports = userProductRouter;