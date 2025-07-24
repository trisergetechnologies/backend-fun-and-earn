const express = require('express');
const { getTeam } = require('../../controllers/user/tree.controller.user');
const userTreeRouter = express.Router();

userTreeRouter.get('/getteam', getTeam);

module.exports = userTreeRouter;