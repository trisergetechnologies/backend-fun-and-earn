const mongoose = require('mongoose');

const UserAdDailySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  dateKey: { type: String, required: true },
  count: { type: Number, default: 0 },
});

UserAdDailySchema.index({ userId: 1, dateKey: 1 }, { unique: true });

module.exports = mongoose.model('UserAdDaily', UserAdDailySchema);
