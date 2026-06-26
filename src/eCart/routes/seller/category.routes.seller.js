const express = require('express');
const { getCategories } = require('../../controllers/seller/category.controller.seller');

const sellerCategoryRouter = express.Router();

sellerCategoryRouter.get('/getcategory', getCategories);

module.exports = sellerCategoryRouter;
