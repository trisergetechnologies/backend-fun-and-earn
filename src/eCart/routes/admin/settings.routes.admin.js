const express = require('express');
const { getSettings, updateSettings } = require('../../controllers/admin/settings.controller.admin');
const adminSettingsRouter = express.Router();

adminSettingsRouter.get('/getsettings', getSettings);
adminSettingsRouter.put('/updatesettings', updateSettings);

module.exports = adminSettingsRouter;
