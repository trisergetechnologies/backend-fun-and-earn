const SystemEarningLogSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: 0 },

  type: {
    type: String,
    enum: ['inflow', 'outflow'], // inflow = leftovers credited, outflow = rewards paid
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
      'adminAdjustment'
    ],
    required: true
  },

  fromUser: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: function () { return this.type === 'inflow'; } // required only for inflows
  },

  context: { type: String, default: '' }, // details: "Week 39 payout", "Gold limit leftover", etc.

  status: { type: String, enum: ['success', 'failed'], default: 'success' }
}, { timestamps: true });

module.exports = mongoose.model('SystemEarningLog', SystemEarningLogSchema);
