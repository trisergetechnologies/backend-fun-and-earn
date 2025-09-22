const Express = require('express');
const { getTeam, getNetwork } = require('../../controllers/admin/tree.controller.admin');

const shortVideoAdminRouter = Express.Router();

shortVideoAdminRouter.get('/getteam', getTeam);
shortVideoAdminRouter.get('/getnetwork', getNetwork);

module.exports = shortVideoAdminRouter