const express = require("express");
const eCartRouter = express.Router();

const eCartUserRouter = require("./user");
const authMiddleware = require("../../middlewares/authMiddleware");


eCartRouter.use('/user', authMiddleware(["user"]), eCartUserRouter);

module.exports = eCartRouter;