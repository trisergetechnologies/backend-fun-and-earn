const express = require('express');
const { getFeed, logWatchTime, toggleLike } = require('../../controllers/user/watch.controller.user');
const userWatchRouter = express.Router();

userWatchRouter.get('/getfeed', getFeed);
userWatchRouter.put('/logwatchtime', logWatchTime);
userWatchRouter.put('/togglelike', toggleLike);

module.exports = userWatchRouter;