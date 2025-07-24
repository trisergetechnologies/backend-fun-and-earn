const express = require('express');
const { purchasePackage } = require('../../controllers/user/package.controller.user');
const userPackageRouter = express.Router();

userPackageRouter.post('/purchasepackage', purchasePackage);

module.exports = userPackageRouter;