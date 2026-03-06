const express = require('express');
const { purchasePackage, getPackages, getMyAchievement, getPackageOrders, getMyMonthlyAchievement, purchasePackageInternal } = require('../../controllers/user/package.controller.user');
const userPackageRouter = express.Router();

userPackageRouter.post('/purchasepackage', (req,res)=>{
    return res.status(200).json({
      success: true,
      message: `Please Buy This from Dream Mart`,
      data: null
    });
});
userPackageRouter.get('/getpackage', getPackages);
userPackageRouter.get('/getpackageorders', getPackageOrders);

userPackageRouter.get('/getmyachievement', getMyAchievement);
userPackageRouter.get('/getmymonthlyachievement', getMyMonthlyAchievement);

userPackageRouter.post('/purchasepackageinternal', purchasePackageInternal);

module.exports = userPackageRouter;