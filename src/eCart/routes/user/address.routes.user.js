const express = require('express');
const { getAddresses } = require('../../controllers/user/address.controller');
const userAddressRouter = express.Router();

userAddressRouter.get('/addresses', getAddresses);


module.exports = userAddressRouter;