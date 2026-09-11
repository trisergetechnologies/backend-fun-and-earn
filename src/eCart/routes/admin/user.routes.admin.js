const express = require('express');
const { getUsers, getMe, adminShortVideoActivate } = require('../../controllers/admin/user.controller.admin');
const {
  rechargeECartWallet,
  deductECartWallet,
} = require('../../controllers/admin/wallet.controller.admin');

const adminUserRouter = express.Router();

adminUserRouter.get('/getusers', getUsers);
adminUserRouter.get('/getusers/:id', getUsers);

adminUserRouter.get('/getme', getMe);

adminUserRouter.put('/adminshortvideoactivate', adminShortVideoActivate);

// Dream Mart wallet adjust (same handlers as /wallet; mounted here with other user admin tools)
adminUserRouter.put('/rechargeecartwallet', rechargeECartWallet);
adminUserRouter.put('/deductecartwallet', deductECartWallet);

module.exports = adminUserRouter;
