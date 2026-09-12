const express = require('express');
const adminCtrl = require('../../controllers/admin.controller');
const e2eCtrl = require('../../controllers/e2e.controller');

const router = express.Router();

router.get('/health', adminCtrl.getHealth);
router.post('/seed', adminCtrl.seed);
router.put('/enabled', adminCtrl.setEnabled);
router.get('/configs', adminCtrl.getConfigs);
router.put('/configs/:level', adminCtrl.updateConfig);
router.get('/participations', adminCtrl.searchParticipations);
router.get('/participations/:id/journey', adminCtrl.getParticipationJourney);
router.get('/matrix', adminCtrl.getMatrix);
router.get('/placements', adminCtrl.getPlacementQueue);
router.get('/ledgers', adminCtrl.getLedgers);
router.get('/cycles', adminCtrl.getCycles);
router.get('/balances', adminCtrl.getBalances);
router.get('/referrals', adminCtrl.getReferrals);
router.get('/credits', adminCtrl.getCredits);
router.get('/eligibilities', adminCtrl.getEligibilities);
router.post('/bootstrap', adminCtrl.bootstrap);

// Dev-only E2E helpers (403 outside development / AUTOPOOL_E2E_ALLOW)
router.post('/e2e/provision', e2eCtrl.provision);
router.post('/e2e/reset', e2eCtrl.reset);
router.post('/e2e/bootstrap-pool', e2eCtrl.bootstrapPool);
router.post('/e2e/place-filler', e2eCtrl.placeFiller);
router.post('/e2e/advance-cycles', e2eCtrl.advanceCycles);

module.exports = router;
