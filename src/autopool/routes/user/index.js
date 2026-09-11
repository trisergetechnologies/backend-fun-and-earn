const express = require('express');
const userCtrl = require('../../controllers/user.controller');

const router = express.Router();

router.get('/overview', userCtrl.getOverview);
router.get('/pools/:level', userCtrl.getPool);
router.get('/participations/:id', userCtrl.getParticipation);
router.get('/credits', userCtrl.getCredits);
router.get('/referrals', userCtrl.getReferrals);
router.post('/pools/1/join', userCtrl.joinPool1);
router.post('/pools/:level/join-next', userCtrl.joinNext);

module.exports = router;
