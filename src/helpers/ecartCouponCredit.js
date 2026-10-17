function round2(value) {
  if (value == null || Number.isNaN(Number(value))) return 0;
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * After debiting eCartWallet on an in-memory user doc, shrink coupon credit
 * by min(debit, credit) so 0 ≤ eCartCouponCredit ≤ eCartWallet.
 */
function syncCouponCreditAfterEcartDebit(user, debitAmount) {
  if (!user?.wallets) return;
  const debit = round2(debitAmount);
  if (debit <= 0) return;
  const credit = round2(user.wallets.eCartCouponCredit || 0);
  user.wallets.eCartCouponCredit = round2(Math.max(0, credit - Math.min(credit, debit)));
}

/**
 * Increase coupon credit when Dream Mart is credited from a coupon.
 */
function addEcartCouponCredit(user, amount) {
  if (!user?.wallets) return;
  const add = round2(amount);
  if (add <= 0) return;
  user.wallets.eCartCouponCredit = round2((user.wallets.eCartCouponCredit || 0) + add);
}

/**
 * Aggregation pipeline for atomic eCart debit that also reduces coupon credit
 * by min(debit, credit). Caller must still gate with eCartWallet $gte amount.
 */
function ecartDebitWithCouponCreditPipeline(amount) {
  const debit = round2(amount);
  return [
    {
      $set: {
        'wallets.eCartWallet': {
          $subtract: [{ $ifNull: ['$wallets.eCartWallet', 0] }, debit],
        },
        'wallets.eCartCouponCredit': {
          $max: [
            0,
            {
              $subtract: [
                { $ifNull: ['$wallets.eCartCouponCredit', 0] },
                debit,
              ],
            },
          ],
        },
      },
    },
  ];
}

module.exports = {
  round2,
  syncCouponCreditAfterEcartDebit,
  addEcartCouponCredit,
  ecartDebitWithCouponCreditPipeline,
};
