const Express = require('express');
const { getTeam, getNetwork } = require('../../controllers/admin/tree.controller.admin');
const { getUsersWithWatchTime, creditWatchTimeEarnings, resetAllWatchTime } = require('../../controllers/admin/credit.controller.admin');

const shortVideoAdminRouter = Express.Router();

shortVideoAdminRouter.get('/getteam', getTeam);
shortVideoAdminRouter.get('/getnetwork', getNetwork);

shortVideoAdminRouter.put('/getUsersWithWatchTime', getUsersWithWatchTime);
shortVideoAdminRouter.put('/creditWatchTimeEarnings',creditWatchTimeEarnings);
shortVideoAdminRouter.put('/resetAllWatchTime', resetAllWatchTime);

module.exports = shortVideoAdminRouter