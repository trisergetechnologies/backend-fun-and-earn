const express = require('express');
const { getWallet, getWalletTransactions, redeemCoupon, requestWithdrawal } = require('../../controllers/user/wallet.controller.user');
const userWalletRouter = express.Router();

userWalletRouter.get('/getwallet', getWallet);
userWalletRouter.get('/getwallettransactions', getWalletTransactions);
// userWalletRouter.put('/withdraw', withdrawFunds);
userWalletRouter.post('/redeemcoupon', redeemCoupon);
userWalletRouter.post('/requestwithdrawal', requestWithdrawal);


module.exports = userWalletRouter;