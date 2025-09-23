const Express = require('express');
const { getTeam, getNetwork } = require('../../controllers/admin/tree.controller.admin');
const { getUsersWithWatchTime, creditWatchTimeEarnings, resetAllWatchTime } = require('../../controllers/admin/credit.controller.admin');
const { getSystemWallet, getSystemEarningLogs } = require('../../controllers/admin/system.controller.admin');

const shortVideoAdminRouter = Express.Router();

shortVideoAdminRouter.get('/getteam', getTeam);
shortVideoAdminRouter.get('/getnetwork', getNetwork);

shortVideoAdminRouter.get('/getUsersWithWatchTime', getUsersWithWatchTime);
shortVideoAdminRouter.put('/creditWatchTimeEarnings',creditWatchTimeEarnings);
shortVideoAdminRouter.put('/resetAllWatchTime', resetAllWatchTime);

shortVideoAdminRouter.get('/getSystemWallet', getSystemWallet);
shortVideoAdminRouter.get('/getSystemEarningLogs', getSystemEarningLogs);

module.exports = shortVideoAdminRouter