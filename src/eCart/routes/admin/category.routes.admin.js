const express = require('express');
const { addCategory, updateCategory, deleteCategory, getCategory } = require('../../controllers/admin/categories.controller.admin');
const adminCategoryRouter = express.Router();


adminCategoryRouter.post('/addcategory', addCategory);
adminCategoryRouter.patch('/updatecategory/:id', updateCategory);
adminCategoryRouter.delete('/deletecategory/:id', deleteCategory);
adminCategoryRouter.get('/getcategory', getCategory);

module.exports = adminCategoryRouter;