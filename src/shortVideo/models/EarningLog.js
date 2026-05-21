const mongoose = require('mongoose');

const EarningLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  amount: {
    type: Number,
    required: true,
    min: 0
  },

  source: {
    type: String,
    enum: ['teamPurchase', 'networkPurchase', 'teamWithdrawal', 'networkWithdrawal', 'watchTime', 'weeklyReward', 'monthlyReward'],
    required: true
  },

  fromUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  context: {
    type: String,
    default: ''
  },

  triggeredBy: {
    type: String,
    enum: ['system', 'admin'],
    default: 'system'
  },

  notes: {
    type: String
  },

  status: {
    type: String,
    enum: ['success', 'failed'],
    default: 'success'
  }
}, { timestamps: true });

// Tree/admin: find({ userId }).sort({ createdAt: -1 })
EarningLogSchema.index({ userId: 1, createdAt: -1 });
EarningLogSchema.index({ status: 1, userId: 1, amount: 1 });

const UserEarningLeaderboard = require('./UserEarningLeaderboard');

async function bumpLeaderboard(userId, amount) {
  if (!userId || !amount || amount <= 0) return;
  await UserEarningLeaderboard.findOneAndUpdate(
    { userId },
    { $inc: { totalEarned: amount } },
    { upsert: true, new: true }
  );
}

EarningLogSchema.post('save', async function onEarningLogSave(doc) {
  if (doc.status === 'success') {
    await bumpLeaderboard(doc.userId, doc.amount);
  }
});

EarningLogSchema.post('insertMany', async function onEarningLogInsertMany(docs) {
  const byUser = new Map();
  for (const doc of docs) {
    if (doc.status !== 'success') continue;
    const id = String(doc.userId);
    byUser.set(id, (byUser.get(id) || 0) + Number(doc.amount || 0));
  }
  for (const [userId, total] of byUser) {
    await UserEarningLeaderboard.findOneAndUpdate(
      { userId },
      { $inc: { totalEarned: total } },
      { upsert: true }
    );
  }
});

module.exports = mongoose.model('EarningLog', EarningLogSchema);
