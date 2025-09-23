const express = require('express');
const { getUsers, getMe } = require('../../controllers/admin/user.controller.admin');

const adminUserRouter = express.Router();

adminUserRouter.get('/getusers', getUsers);
adminUserRouter.get('/getusers/:id', getUsers);

adminUserRouter.get('/getme', getMe);

module.exports = adminUserRouter;