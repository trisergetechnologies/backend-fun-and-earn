const mongoose = require('mongoose');

const MartUserAdDailySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  dateKey: { type: String, required: true },
  count: { type: Number, default: 0 },
});

MartUserAdDailySchema.index({ userId: 1, dateKey: 1 }, { unique: true });

module.exports = mongoose.model('MartUserAdDaily', MartUserAdDailySchema);
