const express = require("express");
const eCartRouter = express.Router();

const eCartUserRouter = require("./user");
const authMiddleware = require("../../middlewares/authMiddleware");
const sellerRouter = require("./seller");


eCartRouter.use('/user', authMiddleware(["user"]), eCartUserRouter);
eCartRouter.use('/seller', authMiddleware(["seller"]), sellerRouter);

module.exports = eCartRouter;