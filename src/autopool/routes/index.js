const express = require('express');
const authMiddleware = require('../../middlewares/authMiddleware');
const userRouter = require('./user');
const adminRouter = require('./admin');

const autopoolRouter = express.Router();

autopoolRouter.use('/user', authMiddleware(['user']), userRouter);
autopoolRouter.use('/admin', authMiddleware(['admin']), adminRouter);

module.exports = autopoolRouter;
