const FailedPayment = require("../models/FailedPayment");


// ✅ 1. MOCK PAYMENT VERIFICATION
exports.verifyPayment = async (paymentId) => {
  // Simulate delay
  console.log(`[MOCK] Verifying payment: ${paymentId}`);

  // Return dummy verification response
  return {
    status: 'success', // or 'failed'
    gateway: 'mock',
    amount: 999, 
    currency: 'INR'
  };
};


// ✅ 2. LOG FAILED PAYMENT
exports.logFailedPayment = async ({ userId, paymentId, paidAmount, walletUsed = 0, reason }) => {
  try {
    const failedLog = await FailedPayment.create({
      userId,
      paymentId,
      paidAmount,
      walletUsed,
      reason
    });

    console.log(`[FAILED PAYMENT] Logged: ${failedLog._id}`);
    return failedLog;
  } catch (err) {
    console.error('[FAILED PAYMENT LOGGING ERROR]', err.message);
    return null;
  }
};
