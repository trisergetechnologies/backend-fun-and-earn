const Express = require('express');
const { getTeam, getNetwork } = require('../../controllers/admin/tree.controller.admin');
const { getUsersWithWatchTime, creditWatchTimeEarnings, resetAllWatchTime } = require('../../controllers/admin/credit.controller.admin');
const { getSystemWallet, getSystemEarningLogs } = require('../../controllers/admin/system.controller.admin');

const shortVideoAdminRouter = Express.Router();

shortVideoAdminRouter.get('/getteam', getTeam);
shortVideoAdminRouter.get('/getnetwork', getNetwork);

shortVideoAdminRouter.get('/getuserswithwatchtime', getUsersWithWatchTime);
shortVideoAdminRouter.put('/creditwatchtimeearnings',creditWatchTimeEarnings);
shortVideoAdminRouter.put('/resetallwatchtime', resetAllWatchTime);

shortVideoAdminRouter.get('/getsystemwallet', getSystemWallet);
shortVideoAdminRouter.get('/getsystemearninglogs', getSystemEarningLogs);

module.exports = shortVideoAdminRouter