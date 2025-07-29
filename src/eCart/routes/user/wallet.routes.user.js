const express = require('express');
const { getWallet, getWalletTransactions, withdrawFunds } = require('../../controllers/user/wallet.controller.user');
const userWalletRouter = express.Router();

userWalletRouter.get('/getwallet', getWallet);
userWalletRouter.get('/getwallettransactions', getWalletTransactions);
userWalletRouter.put('/withdraw', withdrawFunds);


module.exports = userWalletRouter;