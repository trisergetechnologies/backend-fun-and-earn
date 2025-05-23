const express = require('express');
const userProductRouter = require('./user/product.routes.user');
const eCartRouter = express.Router();

eCartRouter.use('/ecart', userProductRouter);


modifyRoutes(eCartRouter);