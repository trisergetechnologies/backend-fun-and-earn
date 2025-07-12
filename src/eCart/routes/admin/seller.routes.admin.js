const express = require('express');
const { createSeller, getSellers, updateSeller, deleteSeller } = require('../../controllers/admin/seller.controller.admin');

const adminSellerRouter = express.Router();

adminSellerRouter.post('/createseller', createSeller);
adminSellerRouter.get('/getsellers', getSellers);
adminSellerRouter.get('getsellers/:id', getSellers);
adminSellerRouter.put('/seller/:id', updateSeller);
adminSellerRouter.delete('/seller/:id', deleteSeller);


module.exports = adminSellerRouter;