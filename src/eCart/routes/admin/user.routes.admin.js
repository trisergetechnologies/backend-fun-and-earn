const express = require('express');
const { getUsers } = require('../../controllers/admin/user.controller.admin');

const adminUserRouter = express.Router();

adminUserRouter.get('/getusers', getUsers);
adminUserRouter.get('/getusers/:id', getUsers);

module.exports = adminUserRouter;