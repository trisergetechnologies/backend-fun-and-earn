const express = require('express');
const authRouter = require('./auth.routes');

const commonRouter = express.Router();

commonRouter.use('/auth', authRouter);

module.exports = commonRouter;