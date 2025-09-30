// services/system/captureLeftovers.js
'use strict';

const mongoose = require('mongoose');
const User = require('../../models/User');
// const EarningLog = require('../models/EarningLog');
const SystemEarningLog = require('../../models/SystemEarningLog');
const SystemWallet = require('../../models/SystemWallet');




/**
 * Helper: round to 2 decimals
 */
function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Capture leftover distribution:
 * - Calculate expected vs actual
 * - Log leftover inflow
 * - Update system wallet
 *
 * @param {Object} summary distribution summary returned by a distribute* function
 *   {
 *     type: "purchase" | "withdrawal",
 *     mode: "network" | "team",
 *     userId: ObjectId,
 *     amountBase: Number,
 *     expectedPercent: Number,
 *     actualDistributed: Number
 *   }
 */
async function captureLeftovers(summary) {
  try {
    if (!summary || !summary.amountBase || !summary.expectedPercent) return null;

    const { type, mode, userId, amountBase, expectedPercent, actualDistributed } = summary;

    // Expected total distribution
    const expectedAmount = round2((expectedPercent / 100) * amountBase);
    const leftover = round2(expectedAmount - (actualDistributed || 0));

    if (leftover <= 0) {
      return {
        ...summary,
        expectedAmount,
        leftover: 0,
        skipped: true,
        reason: "No leftovers"
      };
    }

    // Build context string
    const context = `${mode} ${type} leftover: expected=${expectedAmount}, distributed=${actualDistributed}, leftover=${leftover}`;

    // Create system earning log
    await SystemEarningLog.create({
      amount: leftover,
      type: "inflow",
      source: `${mode}${type.charAt(0).toUpperCase() + type.slice(1)}`, // e.g. "networkPurchase"
      fromUser: userId,
      context,
      status: "success"
    });

    // Update system wallet
    await SystemWallet.findOneAndUpdate(
      {},
      { $inc: { totalBalance: leftover } },
      { upsert: true, new: true }
    );

    return {
      ...summary,
      expectedAmount,
      leftover,
      logged: true,
      context
    };
  } catch (err) {
    console.error("captureLeftovers error:", err);
    return { ...summary, leftover: 0, error: err.message };
  }
}

module.exports = { captureLeftovers };















// /**
//  * Percentage arrays (must match your distribution code)
//  */
// const TEAM_PURCHASE_PERCENTAGES = [20, 7.5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1];
// const TEAM_WITHDRAWAL_PERCENTAGES = [5, 2, 1.5, 1.25, 1.10, 1, 0.9, 0.8, 0.7, 0.6];

// /**
//  * Helper: safe rounding to 2 decimals
//  */
// function round2(v) {
//   return Math.round((v + Number.EPSILON) * 100) / 100;
// }

// /**
//  * NETWORK PURCHASE leftovers
//  * - newUser: mongoose user doc OR { _id, serialNumber }
//  * - packagePrice: number
//  * - options.actionId (optional): string to deduplicate (if you want)
//  */
// async function handleNetworkPurchaseLeftover(newUser, packagePrice, options = {}) {
//   try {
//     if (!newUser || typeof packagePrice !== 'number' || packagePrice <= 0) return null;
//     if (!newUser.serialNumber) return null;

//     const buyerId = newUser._id;
//     const buyerSN = Number(newUser.serialNumber);

//     // candidate window = ±20 (diamond max)
//     const minSN = buyerSN - 20;
//     const maxSN = buyerSN + 20;

//     // fetch users in that window (exclude buyer), populate package
//     const recipients = await User.find({
//       serialNumber: { $gte: minSN, $lte: maxSN },
//       _id: { $ne: buyerId }
//     })
//       .select('_id serialNumber package')
//       .populate('package')
//       .lean();

//     if (!recipients || recipients.length === 0) return null;

//     const perHead = round2(0.01 * packagePrice); // 1% per eligible network slot
//     if (perHead <= 0) return null;

//     // Find which recipients have already been credited by distribution code:
//     const recipientIds = recipients.map(r => r._id);
//     const existingLogs = await EarningLog.find({
//       source: 'networkPurchase',
//       fromUser: buyerId,
//       userId: { $in: recipientIds }
//     }).select('userId').lean();

//     const creditedSet = new Set(existingLogs.map(l => String(l.userId)));

//     // missed recipients = those in the diamond window who do NOT have an earning log
//     let missedCount = 0;
//     let missedAmount = 0;
//     const missedRecipients = [];

//     for (const r of recipients) {
//       // skip recipients who actually were credited
//       if (creditedSet.has(String(r._id))) continue;

//       // note: distribution code also checks r.package, but since serialNumber is set only after purchase,
//       // r.package is typically present. We still skip if no package (safe).
//       if (!r.package) continue;

//       missedCount++;
//       missedAmount = round2(missedAmount + perHead);
//       missedRecipients.push(String(r._id));
//     }

//     if (missedAmount <= 0) return null;

//     // Optional dedupe: if caller passes actionId in options, avoid double logging for same action
//     if (options.actionId) {
//       const found = await SystemEarningLog.findOne({
//         source: 'networkPurchase',
//         fromUser: buyerId,
//         context: options.actionId
//       }).lean();

//       if (found) {
//         // already logged for this action
//         return { skipped: true, reason: 'already_logged', found };
//       }
//     }

//     // Create system earning log and update system wallet atomically-ish
//     const context = options.context ||
//       `NetworkPurchase leftover: ${missedCount} missed recipients within ±20 of SN ${buyerSN}` +
//       (missedRecipients.length ? `; missedRecipients=${missedRecipients.slice(0, 20).join(',')}` : '');

//     const log = await SystemEarningLog.create({
//       amount: missedAmount,
//       source: 'networkPurchase',
//       fromUser: buyerId,
//       type: 'inflow',
//       context
//     });

//     await SystemWallet.findOneAndUpdate({}, {
//       $inc: { totalBalance: missedAmount }
//     }, { upsert: true, new: true });

//     return { log, missedCount, missedAmount, context };
//   } catch (err) {
//     console.error('handleNetworkPurchaseLeftover error:', err);
//     return null;
//   }
// }

// /**
//  * TEAM PURCHASE leftovers
//  * - newUser: mongoose user doc OR { _id, referredBy }
//  * - packagePrice: number
//  */
// async function handleTeamPurchaseLeftover(newUser, packagePrice, options = {}) {
//   try {
//     if (!newUser || typeof packagePrice !== 'number' || packagePrice <= 0) return null;

//     const buyerId = newUser._id;

//     // traverse up to 10 levels using referralCode (same logic as your distribution)
//     const referrers = []; // { user, level }
//     let currentReferral = newUser.referredBy; // this stores referralCode in your User schema
//     let level = 0;

//     while (currentReferral && level < 10) {
//       const referrer = await User.findOne({ referralCode: currentReferral }).select('_id package referredBy referralCode').populate('package').lean();

//       if (!referrer || !referrer.package) break; // follow same stop-condition as distribution
//       referrers.push({ user: referrer, level });
//       currentReferral = referrer.referredBy;
//       level++;
//     }

//     if (!referrers.length) return null;

//     // fetch existing teamPurchase logs for these referrers (so we know who was actually credited)
//     const refIds = referrers.map(r => r.user._id);
//     const existingLogs = await EarningLog.find({
//       source: 'teamPurchase',
//       fromUser: buyerId,
//       userId: { $in: refIds }
//     }).select('userId').lean();

//     const creditedSet = new Set(existingLogs.map(l => String(l.userId)));

//     // Now compute missed amounts LEVEL-BY-LEVEL (percent varies)
//     let missedAmount = 0;
//     const missedDetails = []; // for context/debugging

//     for (const { user: ref, level: lvl } of referrers) {
//       const percent = TEAM_PURCHASE_PERCENTAGES[lvl] ?? 0;
//       const amountForThisLevel = round2((packagePrice * percent) / 100);

//       // if this referrer has a log -> they were credited (actual). If not -> missed.
//       if (creditedSet.has(String(ref._id))) {
//         continue;
//       } else {
//         // missed for this level
//         missedAmount = round2(missedAmount + amountForThisLevel);
//         missedDetails.push({ level: lvl, referrerId: String(ref._id), percent, amount: amountForThisLevel });
//       }
//     }

//     if (missedAmount <= 0) return null;

//     // Optional dedupe by actionId
//     if (options.actionId) {
//       const found = await SystemEarningLog.findOne({
//         source: 'teamPurchase',
//         fromUser: buyerId,
//         context: options.actionId
//       }).lean();
//       if (found) {
//         return { skipped: true, reason: 'already_logged', found };
//       }
//     }

//     const context = options.context ||
//       `TeamPurchase leftover: ${missedDetails.length} missed levels; details=${JSON.stringify(missedDetails.slice(0, 20))}`;

//     const log = await SystemEarningLog.create({
//       amount: missedAmount,
//       source: 'teamPurchase',
//       fromUser: buyerId,
//       type: 'inflow',
//       context
//     });

//     await SystemWallet.findOneAndUpdate({}, {
//       $inc: { totalBalance: missedAmount }
//     }, { upsert: true, new: true });

//     return { log, missedAmount, missedDetails, context };
//   } catch (err) {
//     console.error('handleTeamPurchaseLeftover error:', err);
//     return null;
//   }
// }

// /**
//  * NETWORK WITHDRAWAL leftovers
//  * - user: withdrawing user doc
//  * - withdrawalAmount: number
//  */
// async function handleNetworkWithdrawalLeftover(user, withdrawalAmount, options = {}) {
//   try {
//     if (!user || typeof withdrawalAmount !== 'number' || withdrawalAmount <= 0) return null;
//     if (!user.serialNumber) return null;

//     const withdrawerId = user._id;
//     const withdrawerSN = Number(user.serialNumber);

//     // candidate window = ±20
//     const minSN = withdrawerSN - 20;
//     const maxSN = withdrawerSN + 20;

//     const recipients = await User.find({
//       serialNumber: { $gte: minSN, $lte: maxSN },
//       _id: { $ne: withdrawerId }
//     })
//       .select('_id serialNumber package')
//       .populate('package')
//       .lean();

//     if (!recipients || recipients.length === 0) return null;

//     const perHead = round2(withdrawalAmount * 0.004); // 0.4% per eligible
//     if (perHead <= 0) return null;

//     const recipientIds = recipients.map(r => r._id);
//     const existingLogs = await EarningLog.find({
//       source: 'networkWithdrawal',
//       fromUser: withdrawerId,
//       userId: { $in: recipientIds }
//     }).select('userId').lean();

//     const creditedSet = new Set(existingLogs.map(l => String(l.userId)));

//     let missedCount = 0;
//     let missedAmount = 0;
//     const missedRecipients = [];

//     for (const r of recipients) {
//       if (creditedSet.has(String(r._id))) continue;
//       if (!r.package) continue; // keep parity with distribution logic
//       missedCount++;
//       missedAmount = round2(missedAmount + perHead);
//       missedRecipients.push(String(r._id));
//     }

//     if (missedAmount <= 0) return null;

//     if (options.actionId) {
//       const found = await SystemEarningLog.findOne({
//         source: 'networkWithdrawal',
//         fromUser: withdrawerId,
//         context: options.actionId
//       }).lean();
//       if (found) return { skipped: true, reason: 'already_logged', found };
//     }

//     const context = options.context ||
//       `NetworkWithdrawal leftover: ${missedCount} missed recipients within ±20 of SN ${withdrawerSN}; recipients=${missedRecipients.slice(0,20).join(',')}`;

//     const log = await SystemEarningLog.create({
//       amount: missedAmount,
//       source: 'networkWithdrawal',
//       fromUser: withdrawerId,
//       type: 'inflow',
//       context
//     });

//     await SystemWallet.findOneAndUpdate({}, {
//       $inc: { totalBalance: missedAmount }
//     }, { upsert: true, new: true });

//     return { log, missedCount, missedAmount, context };
//   } catch (err) {
//     console.error('handleNetworkWithdrawalLeftover error:', err);
//     return null;
//   }
// }

// /**
//  * TEAM WITHDRAWAL leftovers
//  * - userId: withdrawing user
//  * - withdrawalAmount: number
//  */
// async function handleTeamWithdrawalLeftover(user, withdrawalAmount, options = {}) {
//   try {
//     if (!user || typeof withdrawalAmount !== 'number' || withdrawalAmount <= 0) return null;

//     const withdrawerId = user._id;

//     // traverse up to 10 levels using referralCode
//     const referrers = [];
//     let currentReferral = user.referredBy;
//     let level = 0;

//     while (currentReferral && level < 10) {
//       const referrer = await User.findOne({ referralCode: currentReferral }).select('_id package referredBy referralCode').populate('package').lean();
//       if (!referrer || !referrer.package) break;
//       referrers.push({ user: referrer, level });
//       currentReferral = referrer.referredBy;
//       level++;
//     }

//     if (!referrers.length) return null;

//     // existing logs for these referrers
//     const refIds = referrers.map(r => r.user._id);
//     const existingLogs = await EarningLog.find({
//       source: 'teamWithdrawal',
//       fromUser: withdrawerId,
//       userId: { $in: refIds }
//     }).select('userId').lean();

//     const creditedSet = new Set(existingLogs.map(l => String(l.userId)));

//     let missedAmount = 0;
//     const missedDetails = [];

//     for (const { user: ref, level: lvl } of referrers) {
//       const percent = TEAM_WITHDRAWAL_PERCENTAGES[lvl] ?? 0;
//       const amountForThisLevel = round2((withdrawalAmount * percent) / 100);

//       if (creditedSet.has(String(ref._id))) continue;

//       // missed
//       missedAmount = round2(missedAmount + amountForThisLevel);
//       missedDetails.push({ level: lvl, referrerId: String(ref._id), percent, amount: amountForThisLevel });
//     }

//     if (missedAmount <= 0) return null;

//     if (options.actionId) {
//       const found = await SystemEarningLog.findOne({
//         source: 'teamWithdrawal',
//         fromUser: withdrawerId,
//         context: options.actionId
//       }).lean();
//       if (found) return { skipped: true, reason: 'already_logged', found };
//     }

//     const context = options.context ||
//       `TeamWithdrawal leftover: ${missedDetails.length} missed levels; details=${JSON.stringify(missedDetails.slice(0,20))}`;

//     const log = await SystemEarningLog.create({
//       amount: missedAmount,
//       source: 'teamWithdrawal',
//       fromUser: withdrawerId,
//       type: 'inflow',
//       context
//     });

//     await SystemWallet.findOneAndUpdate({}, {
//       $inc: { totalBalance: missedAmount }
//     }, { upsert: true, new: true });

//     return { log, missedAmount, missedDetails, context };
//   } catch (err) {
//     console.error('handleTeamWithdrawalLeftover error:', err);
//     return null;
//   }
// }

// /**
//  * Public API
//  * - captureLeftoversForPurchase(newUser, packagePrice, options)
//  * - captureLeftoversForWithdrawal(user, withdrawalAmount, options)
//  *
//  * options: { actionId, context } (actionId optional dedupe token)
//  */
// async function captureLeftoversForPurchase(newUser, packagePrice, options = {}) {
//   try {
//     const [net, team] = await Promise.all([
//       handleNetworkPurchaseLeftover(newUser, packagePrice, options),
//       handleTeamPurchaseLeftover(newUser, packagePrice, options)
//     ]);

//     const totalMissed = (net && net.missedAmount ? net.missedAmount : 0) + (team && team.missedAmount ? team.missedAmount : 0);
//     return { network: net, team: team, totalMissed: round2(totalMissed) };
//   } catch (err) {
//     console.error('captureLeftoversForPurchase error:', err);
//     return null;
//   }
// }

// async function captureLeftoversForWithdrawal(user, withdrawalAmount, options = {}) {
//   try {
//     const [net, team] = await Promise.all([
//       handleNetworkWithdrawalLeftover(user, withdrawalAmount, options),
//       handleTeamWithdrawalLeftover(user, withdrawalAmount, options)
//     ]);

//     const totalMissed = (net && net.missedAmount ? net.missedAmount : 0) + (team && team.missedAmount ? team.missedAmount : 0);
//     return { network: net, team: team, totalMissed: round2(totalMissed) };
//   } catch (err) {
//     console.error('captureLeftoversForWithdrawal error:', err);
//     return null;
//   }
// }

// module.exports = {
//   captureLeftoversForPurchase,
//   captureLeftoversForWithdrawal
// };
