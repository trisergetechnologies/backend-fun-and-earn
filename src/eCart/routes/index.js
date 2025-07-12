const express = require("express");
const eCartRouter = express.Router();

const eCartUserRouter = require("./user");
const authMiddleware = require("../../middlewares/authMiddleware");
const sellerRouter = require("./seller");
const adminRouter = require("./admin");


eCartRouter.use('/user', authMiddleware(["user"]), eCartUserRouter);
eCartRouter.use('/seller', authMiddleware(["seller"]), sellerRouter);
eCartRouter.use('/admin', authMiddleware(["admin"]), adminRouter);

module.exports = eCartRouter;