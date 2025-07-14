const Express = require("express");
const { updateProfile, getUserProfile, addBankDetails, updateBankDetails, deleteBankDetails, getRewards } = require("../../controllers/user/general.controller.user");
const userGeneralRouter = Express.Router()

userGeneralRouter.get('/getprofile', getUserProfile);
userGeneralRouter.patch('/updateprofile', updateProfile);
userGeneralRouter.post('/addBankDetails', addBankDetails);
userGeneralRouter.patch('/updateBankDetails', updateBankDetails);
userGeneralRouter.delete('/deleteBankDetails', deleteBankDetails);
userGeneralRouter.get('/getRewards', getRewards);

module.exports = userGeneralRouter;