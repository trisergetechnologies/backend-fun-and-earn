const express = require("express");
const shortVideoUserRouter = require("./user");
const authMiddleware = require("../../middlewares/authMiddleware");
const shortVideoAdminRouter = require("./admin");
const shortVideoRouter = express.Router();

shortVideoRouter.use('/user', authMiddleware(["user"]), shortVideoUserRouter);
shortVideoRouter.use('/admin', authMiddleware(["admin"]), shortVideoAdminRouter);

module.exports = shortVideoRouter;