const Express = require("express");
const { updateProfile, getUserProfile, addBankDetails, updateBankDetails, deleteBankDetails, getRewards, changePassword, getPaymentGateway } = require("../../controllers/user/general.controller.user");
const userGeneralRouter = Express.Router()

userGeneralRouter.get('/getprofile', getUserProfile);
userGeneralRouter.get('/paymentgateway', getPaymentGateway);
userGeneralRouter.patch('/changepassword', changePassword);
userGeneralRouter.patch('/updateprofile', updateProfile);
userGeneralRouter.post('/addbankdetails', addBankDetails);
userGeneralRouter.patch('/updatebankdetails', updateBankDetails);
userGeneralRouter.delete('/deletebankdetails', deleteBankDetails);
userGeneralRouter.get('/getrewards', getRewards);

module.exports = userGeneralRouter;