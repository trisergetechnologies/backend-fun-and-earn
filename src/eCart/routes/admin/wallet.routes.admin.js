const express = require('express');
const { handleWithdrawalRequest, getWithdrawalRequests } = require('../../controllers/admin/wallet.controller.admin');

const adminWalletRouter = express.Router();

adminWalletRouter.post('/handlewithdrawalrequest', handleWithdrawalRequest);
adminWalletRouter.get('/getwithdrawalrequests', getWithdrawalRequests);

module.exports = adminWalletRouter;