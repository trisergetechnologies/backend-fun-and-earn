const express = require('express');
const { purchasePackage, getPackages, getMyAchievement } = require('../../controllers/user/package.controller.user');
const userPackageRouter = express.Router();

userPackageRouter.post('/purchasepackage', purchasePackage);
userPackageRouter.get('/getpackage', getPackages);

userPackageRouter.get('/getmyachievement', getMyAchievement);

module.exports = userPackageRouter;