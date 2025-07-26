const express = require('express');
const { getTeam, getNetwork } = require('../../controllers/user/tree.controller.user');
const userTreeRouter = express.Router();

userTreeRouter.get('/getteam', getTeam);
userTreeRouter.get('/getnetwork', getNetwork);

module.exports = userTreeRouter;