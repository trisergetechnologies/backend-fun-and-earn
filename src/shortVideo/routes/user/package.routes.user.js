const express = require('express');
const { purchasePackage, getPackages } = require('../../controllers/user/package.controller.user');
const userPackageRouter = express.Router();

userPackageRouter.post('/purchasepackage', purchasePackage);
userPackageRouter.post('/getpackage', getPackages);

module.exports = userPackageRouter;