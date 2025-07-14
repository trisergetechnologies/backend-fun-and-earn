const express = require('express');
const { getWallet, getWalletTransactions } = require('../../controllers/user/wallet.controller.user');
const userWalletRouter = express.Router();

userWalletRouter.get('/getwallet', getWallet);
userWalletRouter.get('/getwallettransactions', getWalletTransactions);


module.exports = userWalletRouter;