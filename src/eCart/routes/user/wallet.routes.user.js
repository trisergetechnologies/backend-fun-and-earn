const express = require('express');
const { getWallet, getWalletTransactions, withdrawFunds, redeemCoupon } = require('../../controllers/user/wallet.controller.user');
const userWalletRouter = express.Router();

userWalletRouter.get('/getwallet', getWallet);
userWalletRouter.get('/getwallettransactions', getWalletTransactions);
userWalletRouter.put('/withdraw', withdrawFunds);
userWalletRouter.post('/redeemcoupon', redeemCoupon);


module.exports = userWalletRouter;