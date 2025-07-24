const express = require("express");
const shortVideoUserRouter = require("./user");
const authMiddleware = require("../../middlewares/authMiddleware");
const shortVideoRouter = express.Router();

shortVideoRouter.use('/user', authMiddleware(["user"]), shortVideoUserRouter);

module.exports = shortVideoRouter;