const Express = require("express");
const { getCart, addCart, updateCart, removeItem, clearCart, useWallet } = require("../../controllers/user/cart.controller.user");
const userCartRouter = Express.Router()

userCartRouter.get('/getcart', getCart);
userCartRouter.post('/addcart', addCart);
userCartRouter.patch('/updatecart', updateCart);
userCartRouter.delete('/removeitem/:productId', removeItem);
userCartRouter.delete('/clearcart', clearCart);

userCartRouter.patch('/usewallet', useWallet);

module.exports = userCartRouter;