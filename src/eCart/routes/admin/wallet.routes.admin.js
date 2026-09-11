const express = require('express');
const {
  handleWithdrawalRequest,
  getWithdrawalRequests,
  rechargeECartWallet,
  deductECartWallet,
} = require('../../controllers/admin/wallet.controller.admin');

const adminWalletRouter = express.Router();

adminWalletRouter.post('/handlewithdrawalrequest', handleWithdrawalRequest);
adminWalletRouter.get('/getwithdrawalrequests', getWithdrawalRequests);
adminWalletRouter.put('/rechargeecartwallet', rechargeECartWallet);
adminWalletRouter.put('/deductecartwallet', deductECartWallet);

module.exports = adminWalletRouter;
