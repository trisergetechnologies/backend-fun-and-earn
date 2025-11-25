const express = require('express');
const { getTeam, getNetwork, getEarnings, getSummary } = require('../../controllers/user/tree.controller.user');
const userTreeRouter = express.Router();

userTreeRouter.get('/getteam', getTeam);
userTreeRouter.get('/getnetwork', getNetwork);
userTreeRouter.get('/getearnings', getEarnings);
userTreeRouter.get('/getsummary', getSummary);

module.exports = userTreeRouter;