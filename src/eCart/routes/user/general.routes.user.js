const Express = require("express");
const { updateProfile } = require("../../controllers/user/general.controller.user");
const userGeneralRouter = Express.Router()

userGeneralRouter.patch('/updateprofile', updateProfile);
userGeneralRouter.post('/addBankDetails', updateProfile);
userGeneralRouter.patch('/updateBankDetails', updateProfile);
userGeneralRouter.delete('/deleteBankDetails', updateProfile);
userGeneralRouter.get('/getRewards', updateProfile);

module.exports = userGeneralRouter;