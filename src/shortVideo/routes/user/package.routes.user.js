const express = require('express');
const { purchasePackage, getPackages, getMyAchievement, getPackageOrders, getMyMonthlyAchievement } = require('../../controllers/user/package.controller.user');
const userPackageRouter = express.Router();

userPackageRouter.post('/purchasepackage', purchasePackage);
userPackageRouter.get('/getpackage', getPackages);
userPackageRouter.get('/getpackageorders', getPackageOrders);

userPackageRouter.get('/getmyachievement', getMyAchievement);
userPackageRouter.get('/getmymonthlyachievement', getMyMonthlyAchievement);

module.exports = userPackageRouter;