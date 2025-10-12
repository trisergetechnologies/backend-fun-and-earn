const Express = require('express');
const { getTeam, getNetwork } = require('../../controllers/admin/tree.controller.admin');
const { getUsersWithWatchTime, creditWatchTimeEarnings, resetAllWatchTime, rechargeShortVideoWallet } = require('../../controllers/admin/credit.controller.admin');
const { getSystemWallet, getSystemEarningLogs, transferFundsToPool, payoutWeeklyRewards, getCompleteInfo, transferShortVideoToECart, adminSystemHealth, rechargeSystemWallet, payoutMonthlyRewards } = require('../../controllers/admin/system.controller.admin');
const { getPackagesWithUserCount } = require('../../controllers/admin/package.controller.admin');
const { adminEcartActivate } = require('../../controllers/admin/user.controller.admin');

const shortVideoAdminRouter = Express.Router();


//team & network
shortVideoAdminRouter.get('/getteam', getTeam);
shortVideoAdminRouter.get('/getnetwork', getNetwork);

//watch time related
shortVideoAdminRouter.get('/getuserswithwatchtime', getUsersWithWatchTime);
shortVideoAdminRouter.put('/creditwatchtimeearnings',creditWatchTimeEarnings);
shortVideoAdminRouter.put('/resetallwatchtime', resetAllWatchTime);

//system wallet and weekly/monthly rewards
shortVideoAdminRouter.put('/rechargesystemwallet', rechargeSystemWallet);
shortVideoAdminRouter.get('/getsystemwallet', getSystemWallet);
shortVideoAdminRouter.get('/getsystemearninglogs', getSystemEarningLogs);
shortVideoAdminRouter.put('/transferfundstopool', transferFundsToPool);

shortVideoAdminRouter.post('/payoutweeklyrewards', payoutWeeklyRewards);
shortVideoAdminRouter.post('/payoutmonthlyrewards', payoutMonthlyRewards);

//package related
shortVideoAdminRouter.get('/getpackageswithusercount', getPackagesWithUserCount);

//user reslated
shortVideoAdminRouter.get('/getcompleteinfo', getCompleteInfo);
shortVideoAdminRouter.put('/transfershortvideotoecart', transferShortVideoToECart);
shortVideoAdminRouter.put('/rechargeshortvideowallet', rechargeShortVideoWallet);
shortVideoAdminRouter.put('/adminecartactivate', adminEcartActivate);

shortVideoAdminRouter.get('/health-check', adminSystemHealth);


module.exports = shortVideoAdminRouter