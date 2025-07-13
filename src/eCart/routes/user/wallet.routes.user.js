const express = require('express');
const { getWallet } = require('../../controllers/user/wallet.controller.user');
const userWalletRouter = express.Router();

userWalletRouter.get('/getwallet', getWallet);


module.exports = userWalletRouter;