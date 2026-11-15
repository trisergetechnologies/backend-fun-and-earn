const express = require('express');
const userCtrl = require('../../controllers/user.controller');

const router = express.Router();

router.get('/overview', userCtrl.getOverview);
router.get('/achievers/pools', userCtrl.getAchieverPools);
router.get('/achievers/pools/:level', userCtrl.getPoolAchievers);
router.get('/pools/:level', userCtrl.getPool);
router.get('/participations/:id', userCtrl.getParticipation);
router.get('/credits', userCtrl.getCredits);
router.get('/referrals', userCtrl.getReferrals);
router.post('/pools/1/join', userCtrl.joinPool1);
// :level must be 2 or 3 — validated in joinPoolManual
router.post('/pools/:level/join', userCtrl.joinPoolManual);
router.post('/pools/:level/join-next', userCtrl.joinNext);

module.exports = router;
