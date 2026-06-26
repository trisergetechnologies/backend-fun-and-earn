const express = require('express');
const { getMe } = require('../../controllers/seller/user.controller.seller');

const sellerUserRouter = express.Router();

sellerUserRouter.get('/getme', getMe);

module.exports = sellerUserRouter;
