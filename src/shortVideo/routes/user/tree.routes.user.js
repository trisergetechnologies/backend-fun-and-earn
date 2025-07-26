const express = require('express');
const { getTeam, getNetwork, getEarnings } = require('../../controllers/user/tree.controller.user');
const userTreeRouter = express.Router();

userTreeRouter.get('/getteam', getTeam);
userTreeRouter.get('/getnetwork', getNetwork);
userTreeRouter.get('/getearnings', getEarnings);

module.exports = userTreeRouter;