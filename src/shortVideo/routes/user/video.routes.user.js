const express = require('express');
const { uploadVideo, deleteVideo } = require('../../controllers/user/video.controller.user');
const {singleVideoUpload} = require('../../../middlewares/uploadVideoMiddleware');
const userVideoRouter = express.Router();

userVideoRouter.post('/uploadvideo', singleVideoUpload('video'), uploadVideo);
userVideoRouter.delete('/deletevideo', deleteVideo);

module.exports = userVideoRouter;