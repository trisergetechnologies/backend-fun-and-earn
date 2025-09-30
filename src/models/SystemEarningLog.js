const mongoose = require('mongoose');

const SystemEarningLogSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: 0 },

  type: {
    type: String,
    enum: ['inflow', 'outflow'], // inflow = money into system, outflow = money leaving system
    required: true
  },

  source: {
    type: String,
    enum: [
      'networkPurchase',
      'teamPurchase',
      'networkWithdrawal',
      'teamWithdrawal',
      'weeklyPayout',
      'monthlyPayout',
      'adminAdjustment',
      'shortVideoToECart',  // new: SV → ECART transfer
      'userWithdrawal',     // new: ECART → Bank payout
      'rewardReserve'       // new: Reserve usage for payouts/giveaways
    ],
    required: true
  },

  fromUser: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
  },

  // New: breakdown of distribution (optional, used when money splits into multiple buckets)
  breakdown: {
    team: { type: Number, default: 0 },        // team upline % distributed
    network: { type: Number, default: 0 },     // network distribution
    adminCharge: { type: Number, default: 0 }, // admin commission
    reserve: { type: Number, default: 0 },     // set aside for rewards reserve
    tds: { type: Number, default: 0 },         // TDS deducted on user withdrawal
    remainder: { type: Number, default: 0 }    // rounding remainders, if any
  },

  context: { type: String, default: '' }, // e.g. "Week 39 payout", "Job run at 6am"

  status: { type: String, enum: ['success', 'failed'], default: 'success' }
}, { timestamps: true });

module.exports = mongoose.model('SystemEarningLog', SystemEarningLogSchema);
