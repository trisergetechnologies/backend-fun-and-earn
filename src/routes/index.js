const express = require('express');
const router = express.Router();

//common router imports
const authRouter = require('./auth.routes');

//eCart router import
const eCartRouter = require('../eCart/routes');
const shortVideoRouter = require('../shortVideo/routes');

//Common Routes
router.use('/auth', authRouter);

//eCart Routes
router.use('/ecart', eCartRouter);
router.use('/shortvideo', shortVideoRouter);



module.exports = router;