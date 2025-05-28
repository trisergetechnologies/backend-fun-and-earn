const express = require('express');
const { getAddresses, addAddress, updateAddress, deleteAddress } = require('../../controllers/user/address.controller.user');
const userAddressRouter = express.Router();

userAddressRouter.get('/addresses', getAddresses);
userAddressRouter.post('/addaddress', addAddress);
userAddressRouter.patch('/updateaddress/:slug', updateAddress);
userAddressRouter.delete('/deleteaddress/:slug', deleteAddress);

module.exports = userAddressRouter;